
-- Create a security definer function to search profiles by username/display_name
-- This allows users to find others to start new chats
CREATE OR REPLACE FUNCTION public.search_profiles(search_term text)
RETURNS TABLE (user_id uuid, username text, display_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.username, p.display_name, p.avatar_url
  FROM public.profiles p
  WHERE p.user_id != auth.uid()
    AND (p.username ILIKE '%' || search_term || '%' OR p.display_name ILIKE '%' || search_term || '%')
  LIMIT 20;
$$;
