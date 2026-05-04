REVOKE EXECUTE ON FUNCTION public.can_post_in_conversation(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_channel_conversation(text, text, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_public_channels(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.join_public_channel(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.can_post_in_conversation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_channel_conversation(text, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_public_channels(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_public_channel(uuid) TO authenticated;