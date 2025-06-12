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
});






