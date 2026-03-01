-- Robust direct-chat creation function to avoid client-side RLS race/errors
CREATE OR REPLACE FUNCTION public.create_or_get_direct_conversation(target_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  existing_conv_id uuid;
  new_conv_id uuid;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user is required' USING ERRCODE = '22023';
  END IF;

  IF target_user_id = current_user_id THEN
    RAISE EXCEPTION 'Cannot create chat with yourself' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = target_user_id
  ) THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = 'P0001';
  END IF;

  -- Find existing direct conversation between exactly these two users
  SELECT cp1.conversation_id
  INTO existing_conv_id
  FROM public.conversation_participants cp1
  JOIN public.conversation_participants cp2
    ON cp2.conversation_id = cp1.conversation_id
  WHERE cp1.user_id = current_user_id
    AND cp2.user_id = target_user_id
  GROUP BY cp1.conversation_id
  HAVING COUNT(*) = 2
     AND (
       SELECT COUNT(*)
       FROM public.conversation_participants cp3
       WHERE cp3.conversation_id = cp1.conversation_id
     ) = 2
  LIMIT 1;

  IF existing_conv_id IS NOT NULL THEN
    RETURN existing_conv_id;
  END IF;

  INSERT INTO public.conversations DEFAULT VALUES
  RETURNING id INTO new_conv_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES
    (new_conv_id, current_user_id),
    (new_conv_id, target_user_id);

  RETURN new_conv_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_or_get_direct_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_or_get_direct_conversation(uuid) TO authenticated;