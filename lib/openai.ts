// /lib/openai.ts
import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Prompt base: breve, seguro y en español.
export const SYSTEM_PROMPT = `
Eres Uno de UnoGo. Responde en español, corto, claro y amable.
Si no tienes suficiente contexto, pide 1 dato. No inventes enlaces ni datos personales.
Mantén la respuesta en <= 350 caracteres.
`;
