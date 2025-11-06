import reservedUsernames from './reserved-usernames.json';

export default (username?: string): string | null => {
  if (!username) {
    return 'Username cannot be empty';
  }
  
  // Clean the username for comparison (lowercase, trim)
  const cleanUsername = username.toLowerCase().trim();
  
  // Check if username is too short
  if (cleanUsername.length < 3) {
    return 'Username must be at least 3 characters';
  }
  
  // Check against reserved paths
  if (reservedUsernames.includes(cleanUsername)) {
    return 'This username is reserved'
  }
  
  // Reject usernames containing "nostria"
  if (cleanUsername.includes('nostria')) {
    return 'Username cannot contain "nostria"';
  }
  
  // Add additional validation rules here if needed
  // For example, only allow alphanumeric characters and underscores
  if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
    return 'Username can only contain letters, numbers, and underscores';
  }
  
  return null;
};