# 🚀 Quick Start Guide - Dzeck AI Chat APK

## Instalasi Cepat (5 menit)

### 1. Clone Repository
```bash
git clone https://github.com/Dzakiart19/chat-apk.git
cd chat-apk
```

### 2. Setup Environment
```bash
# Copy .env.example ke .env
cp .env.example .env

# Edit .env dengan Cerebras AI credentials Anda
# Dapatkan dari: https://cloud.cerebras.ai/
```

**Minimal .env:**
```env
CEREBRAS_API_KEY=your-cerebras-api-key-here
CEREBRAS_CHAT_MODEL=qwen-3-235b-a22b-instruct-2507
CEREBRAS_AGENT_MODEL=qwen-3-235b-a22b-instruct-2507
PORT=5000
NODE_ENV=development
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Start Server
```bash
npm run server:dev
```

Server akan berjalan di: `http://localhost:5000`

### 5. Test API
```bash
curl -X POST http://localhost:5000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Halo!"}
    ]
  }'
```

✅ Jika mendapat response JSON, setup berhasil!

---

## 📱 Menggunakan Chat UI

### 1. Import Components
```typescript
import { ChatScreen } from '@/components/ChatScreen';
import { ChatCard } from '@/components/ChatCard';
import { useChat } from '@/lib/useChat';
```

### 2. Gunakan ChatScreen
```typescript
export default function App() {
  return <ChatScreen />;
}
```

### 3. Atau Gunakan Hook Langsung
```typescript
function MyComponent() {
  const { messages, sendMessage, isLoading } = useChat();
  
  const handleSend = async (text) => {
    await sendMessage(text, false); // false = chat mode
  };
  
  return (
    <View>
      {messages.map(msg => (
        <ChatCard key={msg.id} {...msg} />
      ))}
    </View>
  );
}
```

---

## 🎯 Fitur Utama

### Chat Mode (Regular)
- Percakapan normal dengan AI
- Response lengkap (non-streaming)
- Cepat dan stabil

### Agent Mode
- AI bekerja autonomously
- Bisa menggunakan tools
- Real-time event updates (SSE)

### Toggle Mode
```typescript
const { isAgentMode, setIsAgentMode } = useState(false);

// Toggle antara chat dan agent
setIsAgentMode(!isAgentMode);
```

---

## 🔌 API Endpoints

### Chat (Non-Streaming)
```bash
POST /api/chat
Content-Type: application/json

{
  "messages": [
    {"role": "user", "content": "Your message"}
  ]
}
```

**Response:**
```json
{
  "type": "message",
  "content": "AI response here",
  "timestamp": "2026-03-10T16:31:06.491Z"
}
```

### Agent (SSE)
```bash
POST /api/agent
Content-Type: application/json

{
  "message": "Your task here",
  "messages": [],
  "model": "qwen-3-235b-a22b-instruct-2507"
}
```

**Response (SSE):**
```
data: {"type":"session","session_id":"..."}
data: {"type":"message","content":"..."}
data: [DONE]
```

### Status Check
```bash
GET /api/status
```

---

## 🎨 UI Components

### ChatScreen
Main chat interface dengan header, messages, input

```typescript
<ChatScreen />
```

### ChatCard
Individual message card

```typescript
<ChatCard
  type="user"
  content="Hello"
  timestamp={new Date()}
/>
```

### ChatInput
Input area dengan attachment support

```typescript
<ChatInput
  onSend={(text) => console.log(text)}
  isGenerating={false}
  isAgentMode={false}
/>
```

---

## 🧪 Testing

### Test Chat
```bash
curl -X POST http://localhost:5000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Halo!"}]}'
```

### Test Status
```bash
curl http://localhost:5000/api/status
```

### Test dengan jq (pretty print)
```bash
curl -X POST http://localhost:5000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Halo!"}]}' | jq .
```

---

## 🐛 Troubleshooting

### Port Already in Use
```bash
# Change port in .env
PORT=5001

# Or kill existing process
lsof -ti:5000 | xargs kill -9
```

### API Returns 500 Error
1. Check `.env` file is correct
2. Verify Cerebras API key
3. Check network connection
4. Look at server logs

### CORS Issues
```bash
# Add to .env
CORS_ORIGINS=http://localhost:3000,http://localhost:8000
```

### Empty Response
- Verify Cerebras API key is valid
- Check API quota not exceeded
- Ensure model name is correct

---

## 📚 Dokumentasi Lengkap

- `IMPLEMENTATION.md` - Dokumentasi teknis
- `CHANGES.md` - Changelog lengkap
- `README.md` - Overview proyek

---

## 🚀 Next Steps

1. ✅ Setup & test API
2. ✅ Integrate UI components
3. ⏳ Add database persistence
4. ⏳ Deploy to production
5. ⏳ Add user authentication

---

## 💡 Tips & Tricks

### Development
```bash
# Watch mode untuk auto-reload
npm run server:dev

# Build untuk production
npm run server:build
npm run server:prod
```

### Debugging
```bash
# Enable debug logs
DEBUG=* npm run server:dev

# Check API response
curl -v http://localhost:5000/api/status
```

### Performance
- Non-streaming responses lebih cepat
- Gunakan agent mode untuk complex tasks
- Cache responses untuk repeated queries

---

## 🤝 Contributing

1. Fork repository
2. Create feature branch
3. Commit changes
4. Push to branch
5. Create Pull Request

---

## 📞 Support

- GitHub Issues: https://github.com/Dzakiart19/chat-apk/issues
- Documentation: See `IMPLEMENTATION.md`
- Examples: Check test commands above

---

**Happy Coding! 🎉**

Last Updated: March 10, 2026
Version: 2.0.0
