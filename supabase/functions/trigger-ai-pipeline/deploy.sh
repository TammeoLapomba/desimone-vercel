#!/bin/bash
# Deploy Edge Function to Supabase
# Prerequisites: supabase CLI installed + logged in (supabase login)

# Set the n8n webhook URL as a secret
# Replace with your actual n8n VPS URL
supabase secrets set N8N_WEBHOOK_PHOTO_URL=https://YOUR_VPS/webhook/ds-photo-processing \
  --project-ref YOUR_PROJECT_REF

# Deploy the function
supabase functions deploy trigger-ai-pipeline \
  --project-ref YOUR_PROJECT_REF
