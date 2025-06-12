process.env.AZURE_STORAGE_ACCOUNT = "test"
jest.mock('@azure/data-tables')
import accountService, { Account } from "./AccountService";


describe("AccountService", () => {
  let mockTableClient: { upsertEntity: jest.Mock; getEntity: jest.Mock };

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Get the mocked tableClient from the BaseTableStorageService instance
    mockTableClient = (accountService as any).tableClient;
  });

  describe("addAccount", () => {
    it("should create a new account with pubkey and email", async () => {
      const pubkey = "test-pubkey";
      const email = "test@example.com";

      const result = await accountService.addAccount({ pubkey, email });

      // Verify the result
      expect(result).toEqual({
        pubkey,
        email,
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
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        "Replace"
      );
    });

    it("should create a new account with pubkey and null email", async () => {
      const pubkey = "test-pubkey";


      const result = await accountService.addAccount({ pubkey, email: null });

      // Verify the result
      expect(result).toEqual({
        pubkey,
        email: null,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });

      // Verify the upsertEntity was called with correct parameters
      expect(mockTableClient.upsertEntity).toHaveBeenCalledWith(
        {
          partitionKey: "account",
          rowKey: pubkey,
          pubkey,
          email: null,
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

    it("should update an account with optional fields", async () => {
      const originalDate = new Date("2024-01-01");
      const existingAccount: Account = {
        pubkey: "test-pubkey",
        email: "test@example.com",
        createdAt: originalDate,
        updatedAt: originalDate,
      };

      const updatedAccount: Account = {
        ...existingAccount,
        lastLoginDate: new Date(),
      };

      const result = await accountService.updateAccount(updatedAccount);

      // Verify the result has the new lastLoginDate and a new updatedAt timestamp
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
  });
});






