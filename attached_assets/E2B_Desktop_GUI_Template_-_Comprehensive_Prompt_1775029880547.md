# E2B Desktop GUI Template - Comprehensive Prompt

## Project Overview

Buat aplikasi web GUI desktop yang komprehensif untuk mengelola dan mengakses sandbox e2b.dev. Aplikasi ini harus menyediakan antarmuka user-friendly untuk membuat, mengelola, dan berinteraksi dengan desktop sandbox di cloud dengan fitur VNC streaming real-time, file management, command execution, dan monitoring.

## Core Features

### 1. Authentication & API Integration
- **E2B API Integration**: Integrasikan dengan E2B API menggunakan API key yang disimpan secara aman di backend
- **User Authentication**: Implementasikan sistem login/signup dengan JWT token
- **API Key Management**: Halaman untuk user menginput dan mengelola E2B API key mereka
- **Session Management**: Kelola session user dan sandbox connection state

### 2. Sandbox Management Dashboard
- **Sandbox List View**: Tampilkan daftar semua sandbox yang sedang berjalan dan history
  - Menampilkan: Sandbox ID, nama, template, status (running/stopped), waktu dibuat, resource usage
  - Filter & search functionality
  - Sorting options (by name, date, status)
  
- **Create Sandbox Modal/Form**:
  - Pilih template (desktop, code-interpreter, custom)
  - Konfigurasi: resolution, DPI, port, display settings
  - Environment variables setup
  - Start sandbox dan tampilkan status real-time
  
- **Sandbox Details Panel**:
  - Informasi lengkap sandbox (ID, template, uptime, resource usage)
  - Quick actions: restart, stop, delete, snapshot
  - VNC connection details dan URL
  - Logs & monitoring

### 3. VNC Desktop Viewer
- **Embedded VNC Viewer**: Tampilkan desktop sandbox langsung di browser menggunakan VNC streaming
  - Real-time screen capture dan streaming
  - Responsive canvas yang menyesuaikan ukuran
  - Fullscreen mode option
  - Zoom in/out controls
  
- **Mouse & Keyboard Control**:
  - Click detection (left, right, middle click)
  - Mouse movement tracking
  - Keyboard input (text typing, special keys)
  - Clipboard support (copy/paste)
  
- **Desktop Interaction Toolbar**:
  - Screenshot capture button (download as PNG/JPG)
  - Send key combinations (Ctrl+C, Alt+Tab, etc.)
  - Scroll wheel simulation
  - Keyboard layout selector

### 4. File Management
- **File Browser**:
  - Tampilkan file system sandbox dalam tree/list view
  - Navigate directories
  - Preview file contents (text, images, code)
  - File metadata (size, permissions, modified date)
  
- **Upload/Download**:
  - Drag-and-drop file upload ke sandbox
  - Batch upload multiple files
  - Download files dari sandbox
  - Progress indicators
  
- **File Operations**:
  - Create folder
  - Rename file/folder
  - Delete file/folder
  - Copy/move operations
  - Search files

### 5. Terminal & Command Execution
- **Terminal Emulator**:
  - Embedded terminal interface di browser
  - Execute shell commands langsung di sandbox
  - Command history & autocomplete
  - Output streaming dengan syntax highlighting
  - Support untuk interactive commands
  
- **Command Palette**:
  - Quick command shortcuts
  - Common operations (install packages, run scripts, etc.)
  - Custom command templates
  - Command execution history

### 6. Desktop Automation & Scripting
- **Screenshot Capture**:
  - Ambil screenshot desktop sandbox
  - Tampilkan dalam preview
  - Download atau share
  - Screenshot history
  
- **Automation Script Builder**:
  - Visual interface untuk membuat automation scripts
  - Drag-and-drop actions (click, type, wait, scroll)
  - Script editor dengan code highlighting
  - Execute & debug scripts
  - Save & reuse scripts
  
- **Action Recording**:
  - Record desktop actions (clicks, typing, scrolling)
  - Playback recorded actions
  - Export sebagai script

### 7. Monitoring & Analytics
- **Resource Usage Dashboard**:
  - CPU, memory, disk usage graphs
  - Network activity monitoring
  - Real-time metrics update
  - Historical data visualization
  
- **Logs & Events**:
  - System logs viewer
  - Event history (sandbox creation, commands, errors)
  - Log filtering & search
  - Export logs
  
- **Performance Metrics**:
  - Sandbox uptime
  - Command execution time
  - Network latency
  - VNC stream quality metrics

### 8. Settings & Configuration
- **User Settings**:
  - Profile management
  - Notification preferences
  - Theme selection (light/dark mode)
  - Keyboard shortcuts customization
  
- **Sandbox Defaults**:
  - Default template selection
  - Default resolution & DPI
  - Default environment variables
  - Auto-shutdown timeout
  
- **Advanced Settings**:
  - VNC proxy configuration
  - Network settings
  - Storage preferences
  - API rate limiting

## Technical Architecture

### Frontend Stack
- **Framework**: React 18+ dengan TypeScript
- **UI Library**: TailwindCSS 4 untuk styling
- **State Management**: React Context API atau Zustand
- **VNC Viewer**: noVNC library atau similar
- **Terminal Emulator**: Xterm.js atau similar
- **Charts**: Chart.js atau Recharts untuk monitoring
- **HTTP Client**: Axios atau Fetch API

### Backend Stack
- **Runtime**: Node.js dengan Express/Fastify
- **Database**: PostgreSQL dengan Drizzle ORM
- **Authentication**: JWT dengan bcrypt
- **E2B Integration**: @e2b/sdk untuk JavaScript
- **File Storage**: S3 atau local storage untuk file uploads
- **WebSocket**: Real-time updates untuk monitoring & streaming
- **Validation**: Zod atau Joi untuk input validation

### Database Schema
```
Users:
- id (UUID)
- email (unique)
- passwordHash
- e2bApiKey (encrypted)
- createdAt
- updatedAt

Sandboxes:
- id (UUID)
- userId (FK)
- e2bSandboxId
- name
- template
- status (running/stopped/error)
- resolution
- dpi
- createdAt
- updatedAt
- lastAccessedAt

SandboxSessions:
- id (UUID)
- sandboxId (FK)
- vncUrl
- startedAt
- endedAt

CommandHistory:
- id (UUID)
- sandboxId (FK)
- command
- output
- exitCode
- executedAt

FileUploads:
- id (UUID)
- sandboxId (FK)
- fileName
- fileSize
- filePath
- uploadedAt

Scripts:
- id (UUID)
- userId (FK)
- name
- content (JSON)
- createdAt
- updatedAt

Metrics:
- id (UUID)
- sandboxId (FK)
- cpuUsage
- memoryUsage
- diskUsage
- timestamp
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user
- `POST /api/auth/refresh` - Refresh JWT token

### E2B API Key Management
- `POST /api/settings/e2b-key` - Set E2B API key
- `GET /api/settings/e2b-key` - Get E2B API key status
- `DELETE /api/settings/e2b-key` - Delete E2B API key

### Sandbox Management
- `GET /api/sandboxes` - List all sandboxes
- `POST /api/sandboxes` - Create new sandbox
- `GET /api/sandboxes/:id` - Get sandbox details
- `PUT /api/sandboxes/:id` - Update sandbox
- `DELETE /api/sandboxes/:id` - Delete sandbox
- `POST /api/sandboxes/:id/start` - Start sandbox
- `POST /api/sandboxes/:id/stop` - Stop sandbox
- `POST /api/sandboxes/:id/restart` - Restart sandbox
- `GET /api/sandboxes/:id/screenshot` - Get screenshot
- `GET /api/sandboxes/:id/vnc-url` - Get VNC URL

### File Management
- `GET /api/sandboxes/:id/files` - List files
- `GET /api/sandboxes/:id/files/:path` - Get file content
- `POST /api/sandboxes/:id/files/upload` - Upload file
- `DELETE /api/sandboxes/:id/files/:path` - Delete file
- `POST /api/sandboxes/:id/files/:path/download` - Download file

### Command Execution
- `POST /api/sandboxes/:id/commands` - Execute command
- `GET /api/sandboxes/:id/commands` - Get command history
- `GET /api/sandboxes/:id/commands/:cmdId` - Get command details

### Monitoring
- `GET /api/sandboxes/:id/metrics` - Get metrics
- `GET /api/sandboxes/:id/logs` - Get logs
- `WebSocket /ws/sandboxes/:id/stream` - Real-time metrics stream

### Scripts
- `GET /api/scripts` - List scripts
- `POST /api/scripts` - Create script
- `GET /api/scripts/:id` - Get script
- `PUT /api/scripts/:id` - Update script
- `DELETE /api/scripts/:id` - Delete script
- `POST /api/scripts/:id/execute` - Execute script

## UI/UX Design Guidelines

### Layout Structure
- **Header**: Logo, navigation, user menu, notifications
- **Sidebar**: Navigation menu, quick actions, settings
- **Main Content**: Dynamic content area berdasarkan page
- **Footer**: Status bar, help links, version info

### Color Scheme
- **Primary**: Modern blue (#3B82F6 atau similar)
- **Secondary**: Accent color untuk actions
- **Background**: Light mode (white/light gray), Dark mode (dark gray/black)
- **Status Colors**: Green (running), Red (error), Yellow (warning), Gray (stopped)

### Key Pages

1. **Dashboard/Home**:
   - Welcome message
   - Quick stats (total sandboxes, active sessions)
   - Recent activity
   - Quick action buttons

2. **Sandboxes List**:
   - Table/card view dengan sandbox list
   - Filters & search
   - Bulk actions
   - Create button

3. **Sandbox Detail/Desktop View**:
   - VNC viewer (main area)
   - File browser (sidebar)
   - Terminal (bottom panel)
   - Toolbar dengan actions

4. **Settings**:
   - User settings
   - API key management
   - Preferences
   - Advanced options

5. **Monitoring/Analytics**:
   - Metrics dashboard
   - Charts & graphs
   - Log viewer
   - Performance history

## Security Considerations

- **API Key Security**: Encrypt E2B API keys di database, jangan expose ke frontend
- **Authentication**: Implement proper JWT token expiration & refresh mechanism
- **CORS**: Configure CORS properly untuk frontend-backend communication
- **Input Validation**: Validate semua user inputs di backend
- **Rate Limiting**: Implement rate limiting untuk API endpoints
- **File Upload Security**: Validate file types & sizes, scan untuk malware
- **Session Management**: Implement session timeout & auto-logout
- **HTTPS Only**: Enforce HTTPS untuk production
- **CSP Headers**: Implement Content Security Policy headers
- **CSRF Protection**: Implement CSRF tokens untuk state-changing operations

## Performance Optimization

- **Lazy Loading**: Load components & data on demand
- **Caching**: Implement caching untuk frequently accessed data
- **Image Optimization**: Compress & optimize images
- **Code Splitting**: Split code untuk faster initial load
- **Database Indexing**: Index frequently queried fields
- **API Response Compression**: Gzip responses
- **CDN**: Use CDN untuk static assets
- **Database Connection Pooling**: Implement connection pooling

## Deployment & DevOps

- **Environment Variables**: Use .env files untuk configuration
- **Docker**: Containerize aplikasi untuk easy deployment
- **CI/CD**: Implement GitHub Actions untuk automated testing & deployment
- **Database Migrations**: Use Drizzle migrations untuk schema updates
- **Monitoring**: Implement error tracking (Sentry) & logging
- **Backup**: Regular database backups
- **Scaling**: Design untuk horizontal scaling

## Testing Strategy

- **Unit Tests**: Test individual functions & components
- **Integration Tests**: Test API endpoints & database operations
- **E2E Tests**: Test user workflows end-to-end
- **Performance Tests**: Load testing & performance benchmarks
- **Security Tests**: Penetration testing & security audits

## Documentation

- **API Documentation**: Swagger/OpenAPI docs
- **User Guide**: Step-by-step guide untuk menggunakan aplikasi
- **Developer Guide**: Setup & development instructions
- **Architecture Documentation**: System design & architecture
- **Troubleshooting Guide**: Common issues & solutions

## Future Enhancements

- **Team Collaboration**: Share sandboxes dengan team members
- **Custom Templates**: Allow users membuat custom sandbox templates
- **Scheduled Tasks**: Schedule commands untuk run at specific times
- **Webhooks**: Trigger external actions berdasarkan sandbox events
- **AI Integration**: Integrate dengan LLMs untuk automated desktop control
- **Mobile App**: Mobile version untuk iOS/Android
- **Advanced Analytics**: Detailed analytics & insights
- **Multi-Cloud Support**: Support untuk multiple cloud providers
- **Cost Optimization**: Cost tracking & optimization recommendations
- **Backup & Recovery**: Automated backup & disaster recovery

## Success Metrics

- **User Engagement**: Daily/monthly active users
- **Performance**: Page load time < 2s, VNC latency < 100ms
- **Reliability**: 99.9% uptime
- **User Satisfaction**: NPS score > 50
- **Adoption**: Growth in user base & sandbox creation

## Notes & Considerations

- E2B provides desktop sandbox dengan Ubuntu 22.04 + XFCE desktop + VNC streaming
- Desktop SDK menyediakan methods untuk: mouse control, keyboard input, screenshots, screen size queries
- VNC streaming accessible via port 6080 (default) dengan noVNC
- Sandbox dapat dikustomisasi dengan template definitions
- API key diperlukan untuk authenticate dengan E2B service
- Sandbox memiliki resource limits (CPU, memory, disk)
- File operations dapat dilakukan via SDK atau terminal commands
- Real-time monitoring memerlukan WebSocket connections
- Multi-user support memerlukan proper isolation & permission management
