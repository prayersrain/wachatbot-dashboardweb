export default async function handler(req, res) {
  // Hanya menerima method POST
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const apiUrl = process.env.VITE_API_URL;
  
  if (!apiUrl) {
    return res.status(500).json({ success: false, error: 'VITE_API_URL environment variable is not set in Vercel' });
  }

  try {
    // Vercel Server backend akan melakukan request ke HTTP VPS Anda
    // Ini menghindari masalah "Mixed Content" di browser!
    const response = await fetch(`${apiUrl}/api/bot/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Error forwarding request to VPS:', error);
    return res.status(500).json({ success: false, error: 'Gagal menghubungi VPS. Pastikan bot dan IP benar.' });
  }
}
