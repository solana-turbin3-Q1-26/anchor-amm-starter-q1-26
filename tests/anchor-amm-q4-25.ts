import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorAmmQ425 } from "../target/types/anchor_amm_q4_25";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { assert } from "chai";

describe("anchor-amm-q4-25", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.anchorAmmQ425 as Program<AnchorAmmQ425>;
  const connection = provider.connection;

  // Accounts
  const authority = provider.wallet;
  const user = anchor.web3.Keypair.generate();

  // states
  const seed = new anchor.BN(1111);
  const fee = 30;

  // PDAs
  let mintLpPda: anchor.web3.PublicKey;
  let configPda: anchor.web3.PublicKey;
  let configBump: number;
  let lpBump: number;
  let mintX: anchor.web3.PublicKey;
  let mintY: anchor.web3.PublicKey;
  let vaultX: anchor.web3.PublicKey;
  let vaultY: anchor.web3.PublicKey;
  let userX: anchor.web3.PublicKey;
  let userY: anchor.web3.PublicKey;
  let userLp: anchor.web3.PublicKey;

  before(async () => {
    await connection.requestAirdrop(authority.publicKey, 5_000_000_000); // 5 SOL
    await connection.requestAirdrop(user.publicKey, 5_000_000_000); // 5 SOL
    await new Promise((resolve) => setTimeout(resolve, 1000));

    mintX = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      6,
    );
    mintY = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      6,
    );

    [configPda, configBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config"), seed.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );

    [mintLpPda, lpBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lp"), configPda.toBuffer()],
      program.programId,
    );

    vaultX = getAssociatedTokenAddressSync(mintX, configPda, true);
    vaultY = getAssociatedTokenAddressSync(mintY, configPda, true);

    userLp = getAssociatedTokenAddressSync(mintLpPda, user.publicKey);
  });

  it("initialize the AMM config", async () => {
    const tx = await program.methods
      .initialize(seed, fee, authority.publicKey)
      .accountsStrict({
        initializer: authority.publicKey,
        mintX,
        mintY,
        mintLp: mintLpPda,
        vaultX,
        vaultY,
        config: configPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const config = await program.account.config.fetch(configPda);

    assert.equal(config.authority.toBase58(), authority.publicKey.toBase58());
    assert.equal(config.seed.toNumber(), seed.toNumber());
    assert.equal(config.fee, fee);
    assert.equal(config.locked, false);
    assert.equal(config.mintX.toBase58(), mintX.toBase58());
    assert.equal(config.mintY.toBase58(), mintY.toBase58());
    assert.equal(config.configBump, configBump);
    assert.equal(config.lpBump, lpBump);
  });

  it("should mint tokens to user", async () => {
    userX = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        user,
        mintX,
        user.publicKey,
      )
    ).address;

    userY = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        user,
        mintY,
        user.publicKey,
      )
    ).address;

    await mintTo(
      provider.connection,
      user,
      mintX,
      userX,
      authority.payer,
      1_000_000_000,
    );
    await mintTo(
      provider.connection,
      user,
      mintY,
      userY,
      authority.payer,
      1_000_000_000,
    );
  });

  it("should deposit and withdraw", async () => {
    // Deposit variables
    const depositLpAmount = new anchor.BN(1_000_000);
    const maxX = new anchor.BN(500_000_000);
    const maxY = new anchor.BN(500_000_000);
    // Withdraw variables
    const withdrawLpAmount = new anchor.BN(500_000);
    const minX = new anchor.BN(0);
    const minY = new anchor.BN(0);

    const vaultXBefore = Number(
      (await getAccount(provider.connection, vaultX)).amount,
    );
    const vaultYBefore = Number(
      (await getAccount(provider.connection, vaultY)).amount,
    );
    const userXBefore = Number(
      (await getAccount(provider.connection, userX)).amount,
    );
    const userYBefore = Number(
      (await getAccount(provider.connection, userY)).amount,
    );

    await program.methods
      .deposit(depositLpAmount, maxX, maxY)
      .accountsStrict({
        user: user.publicKey,
        mintX,
        mintY,
        config: configPda,
        mintLp: mintLpPda,
        vaultX,
        vaultY,
        userX,
        userY,
        userLp,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const vaultXAfterDeposit = Number(
      (await getAccount(provider.connection, vaultX)).amount,
    );
    const vaultYAfterDeposit = Number(
      (await getAccount(provider.connection, vaultY)).amount,
    );
    const userXAfterDeposit = Number(
      (await getAccount(provider.connection, userX)).amount,
    );
    const userYAfterDeposit = Number(
      (await getAccount(provider.connection, userY)).amount,
    );
    const userLpAfterDeposit = Number(
      (await getAccount(provider.connection, userLp)).amount,
    );

    // Vaults should increase
    assert.ok(
      vaultXAfterDeposit > vaultXBefore,
      "Vault X did not decrease after deposit",
    );
    assert.ok(
      vaultYAfterDeposit > vaultYBefore,
      "Vault Y did not decrease after deposit",
    );

    // User tokens should decrease
    assert.ok(
      userXAfterDeposit < userXBefore,
      "User X did not increase after deposit",
    );
    assert.ok(
      userYAfterDeposit < userYBefore,
      "User Y did not increase after deposit",
    );

    assert.equal(userLpAfterDeposit, depositLpAmount.toNumber());

    await program.methods
      .withdraw(withdrawLpAmount, minX, minY)
      .accountsStrict({
        user: user.publicKey,
        mintX,
        mintY,
        config: configPda,
        mintLp: mintLpPda,
        vaultX,
        vaultY,
        userX,
        userY,
        userLp,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const vaultXAfterWithdraw = Number(
      (await getAccount(provider.connection, vaultX)).amount,
    );
    const vaultYAfterWithdraw = Number(
      (await getAccount(provider.connection, vaultY)).amount,
    );
    const userXAfterWithdraw = Number(
      (await getAccount(provider.connection, userX)).amount,
    );
    const userYAfterWithdraw = Number(
      (await getAccount(provider.connection, userY)).amount,
    );
    const userLpAfterWithdraw = Number(
      (await getAccount(provider.connection, userLp)).amount,
    );

    // Vaults should decrease
    assert.ok(
      vaultXAfterWithdraw < vaultXAfterDeposit,
      "Vault X did not decrease after withdraw",
    );
    assert.ok(
      vaultYAfterWithdraw < vaultYAfterDeposit,
      "Vault Y did not decrease after withdraw",
    );

    // User tokens should increase
    assert.ok(
      userXAfterWithdraw > userXAfterDeposit,
      "User X did not increase after withdraw",
    );
    assert.ok(
      userYAfterWithdraw > userYAfterDeposit,
      "User Y did not increase after withdraw",
    );
  });

  it("should swap X for Y", async () => {
    const swapAmount = new anchor.BN(100_000_000);
    const minOut = new anchor.BN(1);

    const beforeUserX = await provider.connection.getTokenAccountBalance(userX);
    const beforeUserY = await provider.connection.getTokenAccountBalance(userY);

    await program.methods
      .swap(true, swapAmount, minOut)
      .accountsStrict({
        user: user.publicKey,
        mintX,
        mintY,
        config: configPda,
        vaultX,
        vaultY,
        userX,
        userY,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const afterUserX = await provider.connection.getTokenAccountBalance(userX);
    const afterUserY = await provider.connection.getTokenAccountBalance(userY);

    assert.ok(afterUserX.value.amount <= beforeUserX.value.amount, "X not deducted");
    assert.ok(afterUserY.value.amount >= beforeUserY.value.amount, "Y not received");
  });
});
