ALTER TABLE public.call_signals
ADD COLUMN IF NOT EXISTS call_id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS idx_call_signals_receiver_conversation_type_created
ON public.call_signals (receiver_id, conversation_id, signal_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_signals_call_id_created
ON public.call_signals (call_id, created_at DESC);
