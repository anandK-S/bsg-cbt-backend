import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';
import connectDB from './config/db';
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import examRoutes from './routes/examRoutes';
import { attemptRoutes } from './routes/attemptRoutes';
import settingRoutes from './routes/settingRoutes';
import path from 'path';

dotenv.config();

const port = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

const app = express();
const httpServer = createServer(app);

// Setup Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Reflect the origin back to support credentials on any LAN/local hostname
      callback(null, origin || true);
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('join-exam', ({ examId, candidateId }) => {
    socket.join(examId);
    console.log(`Candidate ${candidateId} joined exam room ${examId}`);
  });

  socket.on('join-monitor-room', () => {
    socket.join('monitor-room'); // Examiners listen here
  });

  socket.on('status-update', (data) => {
    io.to('monitor-room').emit('candidate-status', data);
  });

  socket.on('force-pause', (data) => {
    // Send to specific candidate (would need to track socketId per candidate or broadcast to exam room and client filters)
    // For simplicity, broadcast to everyone and let client filter
    io.emit('force-pause', data); 
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    // Reflect the origin back to support credentials on any LAN/local hostname
    callback(null, origin || true);
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/attempts', attemptRoutes);
app.use('/api/settings', settingRoutes);

// Serve static files (media uploads)
app.use('/uploads', express.static(path.join(__dirname, '../../public/uploads')));

app.get('/', (req: Request, res: Response) => {
  res.send('BSG CBT Backend API is running');
});

// Start Server
httpServer.listen(port, () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${port}`);
});
