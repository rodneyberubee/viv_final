// /routes/askAI.js
import { Configuration, OpenAIApi } from 'openai';
import { randomUUID } from 'crypto';

const config = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
});

const openai = new OpenAIApi(config);

export const askAI = async (req, res) => {
  const requestId = randomUUID();
  try {
    const { restaurantId } = req.params;
    const { messages } = req.body;

    if (!restaurantId) {
      console.error(`[askAI][${requestId}] Missing restaurantId in URL`);
      return res.status(400).json({ error: 'Missing restaurantId in URL.' });
    }

    if (!messages || !Array.isArray(messages)) {
      console.error(`[askAI][${requestId}] Invalid input:`, req.body);
      return res.status(400).json({ error: 'Missing or invalid messages array.' });
    }

    const fullMessages = [
      {
        role: 'system',
        content: [
          `You are Viv, a warm and helpful AI concierge for a restaurant.`,
          `You assist with reservations, cancellations, availability, and common questions.`,
          `Always be clear, friendly, and proactive.`,
          ``,
          `If the user has provided all reservation details (name, email, party size, date, time),`,
          `respond with a JSON block ONLY. Example:`,
          ``,
          `{"type":"reservation.complete","parsed":{"name":"Customer Name","contactInfo":"email@example.com","partySize":2,"date":"2025-07-06","timeSlot":"18:00"},"raw":"Thanks Rodney, you're all set for 6pm!"}`,
          ``,
          `If you do NOT have all the details, respond conversationally to ask follow-up questions.`
        ].join('\n')
      },
      ...messages
    ];

    const completion = await openai.createChatCompletion({
      model: 'gpt-4',
      messages: fullMessages,
      temperature: 0.7
    });

    const reply = completion.data.choices?.[0]?.message?.content?.trim() || '⚠️ No response generated.';
    const usage = completion.data.usage;

    console.log(`[askAI][${requestId}] ✅ Viv responded:`, reply.slice(0, 100));
    console.log(`[askAI][${requestId}] Token usage:`, usage);

    try {
      const parsedBlock = JSON.parse(reply);
      if (parsedBlock.type === 'reservation.complete' && parsedBlock.parsed) {
        console.log(`[askAI][${requestId}] ✅ Parsed structured payload for middleware`, parsedBlock);
        return res.status(200).json(parsedBlock);
      }
    } catch (e) {
      // fallback to raw response
    }

    return res.status(200).json({
      type: 'chat',
      raw: reply,
      parsed: null
    });

  } catch (err) {
    const errorData = err?.response?.data || err.message || err;
    console.error(`[askAI][${requestId}] ❌ OpenAI Error:`, errorData);
    return res.status(500).json({ error: 'AI response failed.' });
  }
};
