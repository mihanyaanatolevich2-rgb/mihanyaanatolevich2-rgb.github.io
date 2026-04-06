
CREATE OR REPLACE FUNCTION public.send_push_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://ypynioemwpcsdawsnqne.supabase.co/functions/v1/send-push',
    body := json_build_object(
      'user_id', NEW.user_id,
      'title', NEW.title,
      'body', COALESCE(NEW.body, ''),
      'conversation_id', NEW.conversation_id
    )::jsonb,
    headers := json_build_object(
      'Content-Type', 'application/json'
    )::jsonb
  );

  RETURN NEW;
END;
$$;
