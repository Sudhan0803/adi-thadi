export default function handler(req, res) {
    res.status(200).json({ 
        status: 'ok',
        message: 'Stick Figure Game Server is running',
        timestamp: new Date().toISOString()
    });
}
