-- Runs BEFORE migration 107 in the same rolled-back transaction as 04_money_and_webhook_hardening_test.sql:
-- rows shaped like the ones the old functions stored, so the test can check the migration scrubbed them.
INSERT INTO public.webhook_logs (provider, event_type, payload, headers, signature, signature_valid, processed, idempotency_key) VALUES
  ('flutterwave', 'charge.completed', '{"event":"charge.completed","data":{"tx_ref":"t107-real","amount":5000}}',
   '{"verif-hash":"t107-shared-secret","authorization":"Bearer x","content-type":"application/json","user-agent":"FLW","x-forwarded-for":"1.2.3.4"}',
   't107-shared-secret', true, true, 't107-real'),
  ('flutterwave', 'charge.completed', '{"event":"charge.completed","data":{"tx_ref":"victim-va","amount":900000,"status":"successful"}}',
   '{"content-type":"application/json","x-evil":"1"}', NULL, false, false, 't107-forged'),
  ('nomba', 'payout_failed', '{"event_type":"payout_failed","data":{"transaction":{"merchantTxRef":"DOINGS-WD-x"}}}',
   NULL, NULL, NULL, false, 't107-unknown');
