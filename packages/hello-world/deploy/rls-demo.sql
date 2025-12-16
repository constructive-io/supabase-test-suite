-- Deploy: rls-demo to pg
-- made with <3 @ constructive.io

-- Create rls_test schema
CREATE SCHEMA IF NOT EXISTS rls_test;

-- Create users table
CREATE TABLE IF NOT EXISTS rls_test.pets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- owner_id is the user_id of the user who owns the pet
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- name is the name of the pet
    name TEXT NOT NULL,
    -- breed is the breed of the pet
    breed TEXT NOT NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on both tables
ALTER TABLE rls_test.pets ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for users table
-- Users can view their own data
CREATE POLICY "Users can view own data" ON rls_test.pets
    FOR SELECT USING (auth.uid() = user_id);

-- Users can update their own data
CREATE POLICY "Users can update own data" ON rls_test.pets
    FOR UPDATE USING (auth.uid() = user_id);

-- Users can insert their own data
CREATE POLICY "Users can insert own data" ON rls_test.pets
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can delete their own data
CREATE POLICY "Users can delete own data" ON rls_test.pets
    FOR DELETE USING (auth.uid() = user_id);

-- Grant permissions to anon users
GRANT USAGE ON SCHEMA rls_test TO anon;
GRANT ALL ON rls_test.pets TO anon;

-- Grant permissions to authenticated users
GRANT USAGE ON SCHEMA rls_test TO authenticated;
GRANT ALL ON rls_test.pets TO authenticated;

-- Grant permissions to service role (for admin operations)
GRANT USAGE ON SCHEMA rls_test TO service_role;
GRANT ALL ON rls_test.pets TO service_role;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_user_id ON rls_test.pets(user_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION rls_test.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON rls_test.pets
    FOR EACH ROW
    EXECUTE FUNCTION rls_test.update_updated_at_column();