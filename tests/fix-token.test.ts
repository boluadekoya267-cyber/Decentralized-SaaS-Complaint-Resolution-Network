// fix-token.test.ts
import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface MintRecord {
  amount: number;
  recipient: string;
  metadata: string;
  timestamp: number;
}

interface VestingSchedule {
  startBlock: number;
  durationBlocks: number;
  amount: number;
  claimed: number;
}

interface Delegation {
  delegatee: string;
  untilBlock: number;
}

interface ContractState {
  balances: Map<string, number>;
  minters: Map<string, boolean>;
  mintRecords: Map<number, MintRecord>;
  vestingSchedules: Map<string, VestingSchedule>;
  delegations: Map<string, Delegation>;
  totalMinted: number;
  paused: boolean;
  admin: string;
  mintCounter: number;
  blockHeight: number; // Mocked block height
}

// Mock contract implementation
class FixTokenMock {
  private state: ContractState = {
    balances: new Map(),
    minters: new Map([["deployer", true]]),
    mintRecords: new Map(),
    vestingSchedules: new Map(),
    delegations: new Map(),
    totalMinted: 0,
    paused: false,
    admin: "deployer",
    mintCounter: 0,
    blockHeight: 100, // Starting block
  };

  private MAX_SUPPLY = 1000000000000000;
  private MAX_METADATA_LEN = 256;
  private ERR_UNAUTHORIZED = 100;
  private ERR_PAUSED = 101;
  private ERR_INVALID_AMOUNT = 102;
  private ERR_INVALID_RECIPIENT = 103;
  private ERR_INVALID_MINTER = 104;
  private ERR_ALREADY_REGISTERED = 105;
  private ERR_VESTING_NOT_FOUND = 106;
  private ERR_VESTING_LOCKED = 107;
  private ERR_DELEGATION_ACTIVE = 108;
  private ERR_MAX_SUPPLY_REACHED = 109;

  // Mock block height control
  advanceBlock(blocks: number): void {
    this.state.blockHeight += blocks;
  }

  getName(): ClarityResponse<string> {
    return { ok: true, value: "FixToken" };
  }

  getSymbol(): ClarityResponse<string> {
    return { ok: true, value: "FIX" };
  }

  getDecimals(): ClarityResponse<number> {
    return { ok: true, value: 6 };
  }

  getTotalSupply(): ClarityResponse<number> {
    return { ok: true, value: this.state.totalMinted };
  }

  getBalance(account: string): ClarityResponse<number> {
    return { ok: true, value: this.state.balances.get(account) ?? 0 };
  }

  getMintRecord(mintId: number): ClarityResponse<MintRecord | null> {
    return { ok: true, value: this.state.mintRecords.get(mintId) ?? null };
  }

  isMinter(account: string): ClarityResponse<boolean> {
    return { ok: true, value: this.state.minters.get(account) ?? false };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getVestingSchedule(account: string): ClarityResponse<VestingSchedule | null> {
    return { ok: true, value: this.state.vestingSchedules.get(account) ?? null };
  }

  getDelegation(delegator: string): ClarityResponse<Delegation | null> {
    return { ok: true, value: this.state.delegations.get(delegator) ?? null };
  }

  getEffectiveBalance(account: string): ClarityResponse<number> {
    const baseBalance = this.state.balances.get(account) ?? 0;
    const vesting = this.state.vestingSchedules.get(account);
    let effective = baseBalance;
    if (vesting) {
      const vestedAmount = Math.floor(((this.state.blockHeight - vesting.startBlock) * vesting.amount) / vesting.durationBlocks);
      effective += vestedAmount - vesting.claimed;
    }
    return { ok: true, value: effective };
  }

  transfer(caller: string, amount: number, sender: string, recipient: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (caller !== sender) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (recipient === sender) {
      return { ok: false, value: this.ERR_INVALID_RECIPIENT };
    }
    const senderBalance = this.state.balances.get(sender) ?? 0;
    if (senderBalance < amount) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    this.state.balances.set(sender, senderBalance - amount);
    const recipientBalance = this.state.balances.get(recipient) ?? 0;
    this.state.balances.set(recipient, recipientBalance + amount);
    return { ok: true, value: true };
  }

  mint(caller: string, amount: number, recipient: string, metadata: string): ClarityResponse<boolean> {
    const newTotal = this.state.totalMinted + amount;
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.state.minters.get(caller)) {
      return { ok: false, value: this.ERR_INVALID_MINTER };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (metadata.length > this.MAX_METADATA_LEN) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT }; // Reusing
    }
    if (newTotal > this.MAX_SUPPLY) {
      return { ok: false, value: this.ERR_MAX_SUPPLY_REACHED };
    }
    const currentBalance = this.state.balances.get(recipient) ?? 0;
    this.state.balances.set(recipient, currentBalance + amount);
    this.state.totalMinted += amount;
    const mintId = this.state.mintCounter + 1;
    this.state.mintRecords.set(mintId, {
      amount,
      recipient,
      metadata,
      timestamp: this.state.blockHeight,
    });
    this.state.mintCounter = mintId;
    return { ok: true, value: true };
  }

  burn(caller: string, amount: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    const senderBalance = this.state.balances.get(caller) ?? 0;
    if (senderBalance < amount) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    this.state.balances.set(caller, senderBalance - amount);
    this.state.totalMinted -= amount;
    return { ok: true, value: true };
  }

  addMinter(caller: string, newMinter: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (this.state.minters.get(newMinter)) {
      return { ok: false, value: this.ERR_ALREADY_REGISTERED };
    }
    this.state.minters.set(newMinter, true);
    return { ok: true, value: true };
  }

  removeMinter(caller: string, minter: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.minters.set(minter, false);
    return { ok: true, value: true };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  setAdmin(caller: string, newAdmin: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  setVestingSchedule(caller: string, recipient: string, startBlock: number, durationBlocks: number, amount: number): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (durationBlocks <= 0 || amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    this.state.vestingSchedules.set(recipient, { startBlock, durationBlocks, amount, claimed: 0 });
    return { ok: true, value: true };
  }

  claimVesting(caller: string): ClarityResponse<number> {
    const vesting = this.state.vestingSchedules.get(caller);
    if (!vesting) {
      return { ok: false, value: this.ERR_VESTING_NOT_FOUND };
    }
    const vestedAmount = Math.floor(((this.state.blockHeight - vesting.startBlock) * vesting.amount) / vesting.durationBlocks);
    const claimable = vestedAmount - vesting.claimed;
    if (claimable <= 0) {
      return { ok: false, value: this.ERR_VESTING_LOCKED };
    }
    // Simulate transfer by adjusting balance (assuming admin has tokens)
    const adminBalance = this.state.balances.get(this.state.admin) ?? 0;
    if (adminBalance < claimable) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    this.state.balances.set(this.state.admin, adminBalance - claimable);
    const callerBalance = this.state.balances.get(caller) ?? 0;
    this.state.balances.set(caller, callerBalance + claimable);
    this.state.vestingSchedules.set(caller, { ...vesting, claimed: vesting.claimed + claimable });
    return { ok: true, value: claimable };
  }

  delegate(caller: string, delegatee: string, untilBlock: number): ClarityResponse<boolean> {
    if (untilBlock <= this.state.blockHeight) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (this.state.delegations.get(caller)) {
      return { ok: false, value: this.ERR_DELEGATION_ACTIVE };
    }
    this.state.delegations.set(caller, { delegatee, untilBlock });
    return { ok: true, value: true };
  }

  revokeDelegation(caller: string): ClarityResponse<boolean> {
    if (!this.state.delegations.get(caller)) {
      return { ok: false, value: this.ERR_VESTING_NOT_FOUND }; // Reusing error
    }
    this.state.delegations.delete(caller);
    return { ok: true, value: true };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  minter: "wallet_1",
  user1: "wallet_2",
  user2: "wallet_3",
};

describe("FixToken Contract", () => {
  let contract: FixTokenMock;

  beforeEach(() => {
    contract = new FixTokenMock();
  });

  it("should initialize with correct token metadata", () => {
    expect(contract.getName()).toEqual({ ok: true, value: "FixToken" });
    expect(contract.getSymbol()).toEqual({ ok: true, value: "FIX" });
    expect(contract.getDecimals()).toEqual({ ok: true, value: 6 });
    expect(contract.getTotalSupply()).toEqual({ ok: true, value: 0 });
  });

  it("should allow admin to add minter", () => {
    const addMinter = contract.addMinter(accounts.deployer, accounts.minter);
    expect(addMinter).toEqual({ ok: true, value: true });

    const isMinter = contract.isMinter(accounts.minter);
    expect(isMinter).toEqual({ ok: true, value: true });
  });

  it("should prevent non-admin from adding minter", () => {
    const addMinter = contract.addMinter(accounts.user1, accounts.user2);
    expect(addMinter).toEqual({ ok: false, value: 100 });
  });

  it("should allow minter to mint tokens with metadata", () => {
    contract.addMinter(accounts.deployer, accounts.minter);

    const mintResult = contract.mint(
      accounts.minter,
      1000,
      accounts.user1,
      "Reward for solution"
    );
    expect(mintResult).toEqual({ ok: true, value: true });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 1000 });
    expect(contract.getTotalSupply()).toEqual({ ok: true, value: 1000 });

    const mintRecord = contract.getMintRecord(1);
    expect(mintRecord).toEqual({
      ok: true,
      value: expect.objectContaining({
        amount: 1000,
        recipient: accounts.user1,
        metadata: "Reward for solution",
      }),
    });
  });

  it("should prevent non-minter from minting", () => {
    const mintResult = contract.mint(
      accounts.user1,
      1000,
      accounts.user1,
      "Unauthorized mint"
    );
    expect(mintResult).toEqual({ ok: false, value: 104 });
  });

  it("should allow token transfer between users", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.mint(accounts.minter, 1000, accounts.user1, "Test mint");

    const transferResult = contract.transfer(
      accounts.user1,
      500,
      accounts.user1,
      accounts.user2
    );
    expect(transferResult).toEqual({ ok: true, value: true });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 500 });
    expect(contract.getBalance(accounts.user2)).toEqual({ ok: true, value: 500 });
  });

  it("should prevent transfer of insufficient balance", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.mint(accounts.minter, 100, accounts.user1, "Test mint");

    const transferResult = contract.transfer(
      accounts.user1,
      200,
      accounts.user1,
      accounts.user2
    );
    expect(transferResult).toEqual({ ok: false, value: 102 });
  });

  it("should allow burning tokens", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.mint(accounts.minter, 1000, accounts.user1, "Test mint");

    const burnResult = contract.burn(accounts.user1, 300);
    expect(burnResult).toEqual({ ok: true, value: true });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 700 });
    expect(contract.getTotalSupply()).toEqual({ ok: true, value: 700 });
  });

  it("should pause and unpause contract", () => {
    const pauseResult = contract.pauseContract(accounts.deployer);
    expect(pauseResult).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: true });

    const mintDuringPause = contract.mint(
      accounts.deployer,
      1000,
      accounts.user1,
      "Paused mint"
    );
    expect(mintDuringPause).toEqual({ ok: false, value: 101 });

    const unpauseResult = contract.unpauseContract(accounts.deployer);
    expect(unpauseResult).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
  });

  it("should handle vesting schedules and claims", () => {
    // Pre-mint to admin for vesting pool
    contract.mint(accounts.deployer, 10000, accounts.deployer, "Vesting pool");

    const setVesting = contract.setVestingSchedule(
      accounts.deployer,
      accounts.user1,
      100,
      100,
      1000
    );
    expect(setVesting).toEqual({ ok: true, value: true });

    // Advance to half vesting
    contract.advanceBlock(50);
    const claim1 = contract.claimVesting(accounts.user1);
    expect(claim1).toEqual({ ok: true, value: 500 });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 500 });

    // Advance to full
    contract.advanceBlock(50);
    const claim2 = contract.claimVesting(accounts.user1);
    expect(claim2).toEqual({ ok: true, value: 500 });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 1000 });

    // No more
    const claim3 = contract.claimVesting(accounts.user1);
    expect(claim3).toEqual({ ok: false, value: 107 });
  });

  it("should handle delegations", () => {
    const delegate = contract.delegate(accounts.user1, accounts.user2, 200);
    expect(delegate).toEqual({ ok: true, value: true });

    const delegation = contract.getDelegation(accounts.user1);
    expect(delegation).toEqual({
      ok: true,
      value: { delegatee: accounts.user2, untilBlock: 200 },
    });

    const revoke = contract.revokeDelegation(accounts.user1);
    expect(revoke).toEqual({ ok: true, value: true });

    const noDelegation = contract.getDelegation(accounts.user1);
    expect(noDelegation).toEqual({ ok: true, value: null });
  });

  it("should prevent minting beyond max supply", () => {
    contract.mint(accounts.deployer, 1000000000000000, accounts.user1, "Max mint");
    const overMint = contract.mint(accounts.deployer, 1, accounts.user1, "Over");
    expect(overMint).toEqual({ ok: false, value: 109 });
  });
});