import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req: Request) => {
  try {
    const body = await req.json()
    const record = body.record

    if (!record?.id) {
      return new Response(JSON.stringify({ error: 'missing record' }), { status: 400 })
    }

    const n8nWebhookUrl = Deno.env.get('N8N_WEBHOOK_PHOTO_URL')
    if (!n8nWebhookUrl) {
      return new Response(JSON.stringify({ error: 'N8N_WEBHOOK_PHOTO_URL not set' }), { status: 500 })
    }

    const payload = {
      article_id: record.id,
      sku: record.sku,
      collection_id: record.collection_id,
      coral_material_id: record.coral_material_id,
      metal_material_id: record.metal_material_id,
    }

    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('n8n webhook error:', response.status, text)
      return new Response(JSON.stringify({ error: 'n8n unreachable', detail: text }), { status: 502 })
    }

    return new Response(JSON.stringify({ ok: true, article_id: record.id }), { status: 200 })
  } catch (err) {
    console.error('Edge Function error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
