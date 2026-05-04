CREATE OR REPLACE FUNCTION public.can_post_in_conversation(_conversation_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = _conversation_id
      AND (
        c.is_channel = false
        OR c.created_by = _user_id
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_post_in_conversation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_post_in_conversation(uuid, uuid) TO authenticated;