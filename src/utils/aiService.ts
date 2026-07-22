import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

interface AIParams {
  systemPrompt?: string;
  userPrompt: string;
  image?: {
    base64: string;
    mimeType: string;
  };
  jsonMode?: boolean;
}

export const generateAIContent = async (params: AIParams): Promise<string> => {
  const { systemPrompt, userPrompt, image, jsonMode } = params;

  // Combine system and user prompt for models that don't explicitly separate them in a simple way
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;

  const errors: string[] = [];

  // 1. Try Primary Gemini (gemini-2.5-flash)
  if (process.env.GEMINI_API_KEY) {
    try {
      console.log('Attempting AI generation with Primary Gemini...');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      let contentsPayload: any = fullPrompt;
      
      if (image) {
        contentsPayload = [
          fullPrompt,
          { inlineData: { data: image.base64, mimeType: image.mimeType } }
        ];
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contentsPayload,
      });

      if (response?.text) return response.text;
    } catch (err: any) {
      console.error('Primary Gemini failed:', err?.message || err);
      errors.push(`Gemini Primary: ${err?.message}`);
    }
  }

  // 2. Try Secondary Gemini (gemini-2.5-flash)
  if (process.env.GEMINI_API_KEY_2) {
    try {
      console.log('Attempting AI generation with Secondary Gemini...');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_2 });
      let contentsPayload: any = fullPrompt;
      
      if (image) {
        contentsPayload = [
          fullPrompt,
          { inlineData: { data: image.base64, mimeType: image.mimeType } }
        ];
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contentsPayload,
      });

      if (response?.text) return response.text;
    } catch (err: any) {
      console.error('Secondary Gemini failed:', err?.message || err);
      errors.push(`Gemini Secondary: ${err?.message}`);
    }
  }

  // 3. Try Groq (llama3-70b-8192) - Extremely fast, massive free tier
  if (process.env.GROQ_API_KEY) {
    try {
      console.log('Attempting AI generation with Groq...');
      const openai = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
      
      // Groq does not support vision natively yet, so if there's an image, we might fail or skip
      if (image) {
        throw new Error('Groq does not support vision inputs currently.');
      }

      const messages: any[] = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: userPrompt });

      const response = await openai.chat.completions.create({
        model: 'llama3-70b-8192',
        messages,
        response_format: jsonMode ? { type: 'json_object' } : undefined,
      });

      if (response.choices[0].message?.content) return response.choices[0].message.content;
    } catch (err: any) {
      console.error('Groq failed:', err?.message || err);
      errors.push(`Groq: ${err?.message}`);
    }
  }

  // 4. Try OpenAI (gpt-4o-mini)
  if (process.env.OPENAI_API_KEY) {
    try {
      console.log('Attempting AI generation with OpenAI...');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      
      const messages: any[] = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      
      if (image) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } }
          ]
        });
      } else {
        messages.push({ role: 'user', content: userPrompt });
      }

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        response_format: jsonMode ? { type: 'json_object' } : undefined,
      });

      if (response.choices[0].message?.content) return response.choices[0].message.content;
    } catch (err: any) {
      console.error('OpenAI failed:', err?.message || err);
      errors.push(`OpenAI: ${err?.message}`);
    }
  }

  // 5. Try Anthropic (claude-3-haiku-20240307)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      console.log('Attempting AI generation with Anthropic...');
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      
      const content: any[] = [];
      if (image) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mimeType as any,
            data: image.base64,
          }
        });
      }
      content.push({ type: 'text', text: userPrompt });

      const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 4000,
        system: systemPrompt || undefined,
        messages: [{ role: 'user', content }],
      });

      if (response.content[0].type === 'text') {
        return response.content[0].text;
      }
    } catch (err: any) {
      console.error('Anthropic failed:', err?.message || err);
      errors.push(`Anthropic: ${err?.message}`);
    }
  }

  // 6. Try OpenRouter (liquid/lfm-40b or any default)
  if (process.env.OPENROUTER_API_KEY) {
    try {
      console.log('Attempting AI generation with OpenRouter...');
      const openai = new OpenAI({ 
        apiKey: process.env.OPENROUTER_API_KEY, 
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': 'https://bsg-cbt-portal.com',
          'X-Title': 'BSG CBT Portal',
        }
      });
      
      const messages: any[] = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      
      if (image) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } }
          ]
        });
      } else {
        messages.push({ role: 'user', content: userPrompt });
      }

      const response = await openai.chat.completions.create({
        model: 'liquid/lfm-40b', // Fast and cheap on OpenRouter, or google/gemini-flash-1.5
        messages,
      });

      if (response.choices[0].message?.content) return response.choices[0].message.content;
    } catch (err: any) {
      console.error('OpenRouter failed:', err?.message || err);
      errors.push(`OpenRouter: ${err?.message}`);
    }
  }

  throw new Error(`All AI providers failed or no API keys were configured. Errors: ${errors.join(' | ')}`);
};
