{{ ... }}
  if (from && text && wamid) {
    const phoneId = process.env.META_PHONE_NUMBER_ID!;
    // 1) marcar como leído (para que salgan checks azules)
    await waFetch(`${phoneId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: wamid,
    }); // doc: endpoint messages -> mark as read

    // 2) enviar acuse de recibo inmediato (simula progreso)
    await waFetch(`${phoneId}/messages`, {
      messaging_product: 'whatsapp',
      to: from,
      type: 'text',
      text: { body: 'Recibido, te estaré brindando una respuesta en un instante...' },
    });

    // 3) Llamar a OpenAI y preparar respuesta final
    let aiText = 'Perdona, tuve un problema al pensar mi respuesta.';
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        temperature: 0.4,
      });
      aiText = completion.choices[0]?.message?.content?.trim() || aiText;
      if (aiText.length > 900) aiText = aiText.slice(0, 900) + '…';
    } catch (e) {
      console.error('OpenAI error:', e);
      aiText = 'Ups, no pude responder ahora. ¿Puedes repetir en breve?';
    }

    // 4) Enviar la respuesta final
    await waFetch(`${phoneId}/messages`, {
      messaging_product: 'whatsapp',
      to: from,
      type: 'text',
      text: { body: aiText },
    });
  }
{{ ... }}
