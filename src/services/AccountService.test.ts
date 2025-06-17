process.env.AZURE_STORAGE_ACCOUNT = "test"
jest.mock('@azure/data-tables')
import { createMockIterator } from "../helpers/testHelper";
import { tiers } from "./account/tiers";
import accountService, { Account, DEFAULT_SUBSCRIPTION, Subscription } from "./AccountService";

describe("AccountService", () => {
  let mockTableClient: { upsertEntity: jest.Mock; getEntity: jest.Mock; listEntities: jest.Mock };

  beforeEach(() => {
    // Clear all mocks before each test
    jest.resetAllMocks();

    // Get the mocked tableClient from the BaseTableStorageService instance
    mockTableClient = (accountService as any).tableClient;
  });

  describe("addAccount", () => {
    it("should create a new account with pubkey and email with default free tier", async () => {
      const pubkey = "test-pubkey";
      const email = "test@example.com";

      const result = await accountService.addAccount({ pubkey, email });

      // Verify the result
      expect(result).toEqual({
        pubkey,
        email,
        subscription: DEFAULT_SUBSCRIPTION,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });

      // Verify the upsertEntity was called with correct parameters
      expect(mockTableClient.upsertEntity).toHaveBeenCalledWith(
        {
          partitionKey: "account",
          rowKey: pubkey,
          pubkey,
          email,
          subscription: DEFAULT_SUBSCRIPTION,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        "Replace"
      );
    });

    it("should create a new account with pubkey, username and tier", async () => {
      const pubkey = "test-pubkey";
      const username = "bob";
      const subscription: Subscription = {
        tier: 'premium',
        expiryDate: new Date(Date.now() + 60 * 60 * 1000),
        billingCycle: 'monthly',
        price: {
          priceCents: 100,
          currency: 'USD',
        },
        entitlements: {
          notificationsPerDay: 10,
          features: ['BASIC_WEBPUSH']
        }
      }

      const result = await accountService.addAccount({ pubkey, username, subscription });

      // Verify the result
      expect(result).toEqual({
        pubkey,
        username,
        subscription,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });

      // Verify the upsertEntity was called with correct parameters
      expect(mockTableClient.upsertEntity).toHaveBeenCalledWith(
        {
          partitionKey: "account",
          rowKey: pubkey,
          pubkey,
          username,
          subscription,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        "Replace"
      );
    });

    it("should create a new account with only pubkey", async () => {
      const pubkey = "test-pubkey";

      const result = await accountService.addAccount({ pubkey });

      // Verify the result
      expect(result).toEqual({
        pubkey,
        subscription: DEFAULT_SUBSCRIPTION,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });

      // Verify the upsertEntity was called with correct parameters
      expect(mockTableClient.upsertEntity).toHaveBeenCalledWith(
        {
          partitionKey: "account",
          rowKey: pubkey,
          pubkey,
          subscription: DEFAULT_SUBSCRIPTION,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        "Replace"
      );
    });
  });

  describe("getAccount", () => {
    it("should return an account when it exists", async () => {
      const pubkey = "test-pubkey";
      const mockAccount: Account = {
        pubkey,
        email: "test@example.com",
        subscription: DEFAULT_SUBSCRIPTION,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock the getEntity method
      mockTableClient.getEntity.mockResolvedValueOnce({
        partitionKey: "account",
        rowKey: pubkey,
        ...mockAccount,
      });

      const result = await accountService.getAccount(pubkey);

      // Verify the result
      expect(result).toEqual(mockAccount);

      // Verify getEntity was called with correct parameters
      expect(mockTableClient.getEntity).toHaveBeenCalledWith("account", pubkey);
    });

    it("should return null when account does not exist", async () => {
      const pubkey = "non-existent-pubkey";

      // Mock the getEntity method to throw a 404 error
      mockTableClient.getEntity.mockRejectedValueOnce({
        statusCode: 404,
      });

      const result = await accountService.getAccount(pubkey);

      // Verify the result
      expect(result).toBeNull();

      // Verify getEntity was called with correct parameters
      expect(mockTableClient.getEntity).toHaveBeenCalledWith("account", pubkey);
    });
  });

  describe("updateAccount", () => {
    it("should update an existing account and return the updated account", async () => {
      const originalDate = new Date("2024-01-01");
      const existingAccount: Account = {
        pubkey: "test-pubkey",
        email: "old@example.com",
        subscription: DEFAULT_SUBSCRIPTION,
        createdAt: originalDate,
        updatedAt: originalDate,
      };

      const updatedAccount: Account = {
        ...existingAccount,
        email: "new@example.com",
      };

      const result = await accountService.updateAccount(updatedAccount);

      // Verify the result has the updated email and a new updatedAt timestamp
      expect(result).toEqual({
        ...updatedAccount,
        updatedAt: expect.any(Date),
      });
      expect(result.updatedAt).not.toEqual(originalDate);
      expect(result.updatedAt.getTime()).toBeGreaterThan(originalDate.getTime());

      // Verify the upsertEntity was called with correct parameters
      expect(mockTableClient.upsertEntity).toHaveBeenCalledWith(
        {
          partitionKey: "account",
          rowKey: updatedAccount.pubkey,
          ...updatedAccount,
          updatedAt: expect.any(Date),
        },
        "Replace"
      );
    });

    it("should allow updating username when it's not taken", async () => {
      const originalDate = new Date("2024-01-01");
      const existingAccount: Account = {
        pubkey: "test-pubkey",
        email: "test@example.com",
        subscription: DEFAULT_SUBSCRIPTION,
        createdAt: originalDate,
        updatedAt: originalDate,
      };

      const updatedAccount: Account = {
        ...existingAccount,
        username: "newusername",
      };

      mockTableClient.listEntities.mockReturnValueOnce(createMockIterator([]));

      const result = await accountService.updateAccount(updatedAccount);

      expect(result).toEqual({
        ...updatedAccount,
        updatedAt: expect.any(Date),
      });
      expect(result.updatedAt.getTime()).toBeGreaterThan(originalDate.getTime());
      expect(mockTableClient.upsertEntity).toHaveBeenCalledWith(
        {
          partitionKey: "account",
          rowKey: updatedAccount.pubkey,
          ...updatedAccount,
          updatedAt: expect.any(Date),
        },
        "Replace"
      );

    });

    it("should allow account to keep its existing username", async () => {
      const originalDate = new Date("2024-01-01");
      const existingAccount: Account = {
        pubkey: "test-pubkey",
        email: "test@example.com",
        username: "existinguser",
        subscription: DEFAULT_SUBSCRIPTION,
        createdAt: originalDate,
        updatedAt: originalDate,
      };

      const updatedAccount: Account = {
        ...existingAccount,
        email: "new@example.com",
      };

      mockTableClient.listEntities.mockReturnValueOnce(createMockIterator([]));

      const result = await accountService.updateAccount(updatedAccount);

      expect(result).toEqual({
        ...updatedAccount,
        updatedAt: expect.any(Date),
      });
      expect(result.username).toBe("existinguser");
    });

    it("should throw error when trying to use a taken username", async () => {
      const originalDate = new Date("2024-01-01");
      const existingAccount: Account = {
        pubkey: "test-pubkey",
        email: "test@example.com",
        subscription: DEFAULT_SUBSCRIPTION,
        createdAt: originalDate,
        updatedAt: originalDate,
      };

      const updatedAccount: Account = {
        ...existingAccount,
        username: "takenusername",
      };

      const takenAccount = {
        partitionKey: "account",
        rowKey: "other-pubkey",
        username: "takenusername",
        pubkey: "other-pubkey",
        email: "other@example.com",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockTableClient.listEntities.mockReturnValueOnce(createMockIterator([takenAccount]));

      await expect(accountService.updateAccount(updatedAccount)).rejects.toThrow(
        "Username is already taken"
      );
      expect(mockTableClient.upsertEntity).not.toHaveBeenCalled();
    });
  });

  describe("isUsernameTaken", () => {
    it("should return true when username is taken by another account", async () => {
      const username = "testuser";
      const otherAccount = {
        partitionKey: "account",
        rowKey: "other-pubkey",
        username,
        pubkey: "other-pubkey",
        email: "other@example.com",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockTableClient.listEntities.mockReturnValueOnce(createMockIterator([otherAccount]));

      const result = await accountService.isUsernameTaken(username);
      expect(result).toBe(true);
      expect(mockTableClient.listEntities).toHaveBeenCalledWith({
        queryOptions: { filter: `username eq '${username}'` }
      });
    });

    it("should return false when username is not taken", async () => {
      const username = "testuser";
      mockTableClient.listEntities.mockReturnValueOnce(createMockIterator([]));

      const result = await accountService.isUsernameTaken(username);
      expect(result).toBe(false);
      expect(mockTableClient.listEntities).toHaveBeenCalledWith({
        queryOptions: { filter: `username eq '${username}'` }
      });
    });

    it("should exclude current account when checking username", async () => {
      const username = "testuser";
      const currentPubkey = "current-pubkey";
      mockTableClient.listEntities.mockReturnValueOnce(createMockIterator([]));

      const result = await accountService.isUsernameTaken(username, currentPubkey);
      expect(result).toBe(false);
      expect(mockTableClient.listEntities).toHaveBeenCalledWith({
        queryOptions: { filter: `username eq '${username}' and rowKey ne '${currentPubkey}'` }
      });
    });
  });

  describe("getAccountByUsername", () => {
    it("should return an account when username exists", async () => {
      const username = "testuser";
      const mockAccount: Account = {
        pubkey: "test-pubkey",
        email: "test@example.com",
        username,
        subscription: DEFAULT_SUBSCRIPTION,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockEntity = {
        partitionKey: "account",
        rowKey: mockAccount.pubkey,
        ...mockAccount,
      };

      mockTableClient.listEntities.mockReturnValueOnce(createMockIterator([mockEntity]));

      const result = await accountService.getAccountByUsername(username);

      expect(result).toEqual(mockAccount);
      expect(mockTableClient.listEntities).toHaveBeenCalledWith({
        queryOptions: { filter: `username eq '${username}'` }
      });
    });

    it("should return null when username does not exist", async () => {
      const username = "nonexistentuser";
      mockTableClient.listEntities.mockReturnValueOnce(createMockIterator([]));

      const result = await accountService.getAccountByUsername(username);

      expect(result).toBeNull();
      expect(mockTableClient.listEntities).toHaveBeenCalledWith({
        queryOptions: { filter: `username eq '${username}'` }
      });
    });

    it("should throw error when query fails", async () => {
      const username = "testuser";
      mockTableClient.listEntities.mockImplementationOnce(() => { throw new Error("Database error"); });

      await expect(accountService.getAccountByUsername(username)).rejects.toThrow(
        "Failed to get account by username: Database error"
      );
      expect(mockTableClient.listEntities).toHaveBeenCalledWith({
        queryOptions: { filter: `username eq '${username}'` }
      });
    });
  });
});






