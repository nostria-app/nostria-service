-- SQL Update to change username from 'sondreb' to 'sondreb2' 
-- for account with ID 17e2889fba01021d048a13fd0ba108ad31c38326295460c21e69c43fa8fbe515

-- First, let's verify the current data
SELECT 
    id,
    pubkey,
    username,
    tier,
    created,
    modified
FROM public.accounts 
WHERE id = '17e2889fba01021d048a13fd0ba108ad31c38326295460c21e69c43fa8fbe515';

-- Update the username
UPDATE public.accounts 
SET 
    username = 'sondreb2',
    modified = EXTRACT(EPOCH FROM NOW()) * 1000  -- Update timestamp in milliseconds
WHERE id = '17e2889fba01021d048a13fd0ba108ad31c38326295460c21e69c43fa8fbe515'
  AND username = 'sondreb';  -- Safety check to ensure we're updating the right record

-- Verify the update was successful
SELECT 
    id,
    pubkey,
    username,
    tier,
    created,
    modified
FROM public.accounts 
WHERE id = '17e2889fba01021d048a13fd0ba108ad31c38326295460c21e69c43fa8fbe515';