const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);
const fs = require('fs'); // ⭐️ NEW: File System Module for saving images ⭐️
const path = require('path'); // ⭐️ NEW: Path Module ⭐️

const PORT = 3000;

let messageCount = 0;
let messagesHistory = [];
let onlineUsers = {}; // Stores { username: socket.id }

// Serve the index.html file
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// ⭐️ NEW: Serve static files from the 'uploads' directory ⭐️
// This makes uploaded images accessible via /uploads/filename.png
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

io.on('connection', (socket) => {
  console.log('a user connected');

  // --- User Management ---
  let currentUsername = null;

  // Set username
  socket.on('set username', (username) => {
    if (username && username !== currentUsername) {
      if (currentUsername) {
        delete onlineUsers[currentUsername];
      }
      currentUsername = username;
      onlineUsers[currentUsername] = socket.id;
      console.log(`User set: ${currentUsername} (${socket.id})`);
      
      // Send message history to the newly connected user
      socket.emit('load history', messagesHistory);
    }
  });

  socket.on('disconnect', () => {
    console.log('user disconnected');
    if (currentUsername) {
      delete onlineUsers[currentUsername];
      io.emit('user disconnected', currentUsername);
    }
  });

  // --- Message Handling ---

  socket.on('chat message', (msg) => {
    // Only process messages from users who have set a username
    if (!currentUsername) return;

    const messageData = {
      id: messageCount++,
      user: currentUsername,
      text: msg.text,
      replyToId: msg.replyToId,
      replyToText: msg.replyToText,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      seen: false 
    };

    messagesHistory.push(messageData);
    io.emit('chat message', messageData);
  });
  
  // --- Message Editing & Deleting (Existing Logic) ---

  socket.on('delete message', (messageId) => {
    const messageIndex = messagesHistory.findIndex(m => m.id === Number(messageId));

    if (messageIndex !== -1 && messagesHistory[messageIndex].user === currentUsername) {
      messagesHistory.splice(messageIndex, 1);
      io.emit('delete message', messageId);
      console.log(`Message ${messageId} deleted by ${currentUsername}.`);
    } else {
      console.log(`Attempted deletion of message ${messageId} failed (User mismatch or message not found).`);
    }
  });

  socket.on('edit message', (data) => {
    const message = messagesHistory.find(m => m.id === Number(data.id));

    if (message && message.user === currentUsername) {
      message.text = data.newText;
      io.emit('edit message confirmed', { id: data.id, newText: data.newText });
      console.log(`Message ${data.id} edited by ${currentUsername}.`);
    } else {
      console.log(`Attempted edit of message ${data.id} failed (User mismatch or message not found).`);
    }
  });

  // --- Seen/Unseen Feature (Existing Logic) ---

  socket.on('mark seen', (messageId) => {
    const message = messagesHistory.find(m => m.id === Number(messageId));

    if (message && !message.seen && message.user !== currentUsername) {
      message.seen = true;
      io.emit('message seen', message.id); 
    }
  });
  
  // --- Typing Indicator (Existing Logic) ---

  socket.on('typing', (username) => {
    socket.broadcast.emit('typing', username);
  });

  socket.on('stop typing', (username) => {
    socket.broadcast.emit('stop typing', username);
  });
  
  // ⭐️ NEW: Handle Image Upload (Base64) ⭐️
  socket.on('image upload', (data) => {
    if (!currentUsername) return;

    // 1. Extract the Base64 data part (remove the data URI header)
    const base64Data = data.fileData.split(';base64,').pop();
    const extension = data.fileName.split('.').pop().toLowerCase();
    
    // Safety check for common image extensions
    if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(extension)) {
        console.error('File extension not supported.');
        return;
    }
    
    // Create a unique file name
    const newFileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.${extension}`;
    const filePath = path.join(__dirname, 'uploads', newFileName);
    
    // Write the Base64 data to a new file
    fs.writeFile(filePath, base64Data, { encoding: 'base64' }, (err) => {
        if (err) {
            console.error('Error saving file:', err);
            // Optionally, emit an error message back to the sender
            return;
        }

        // 2. File saved successfully, create a public URL
        const imageUrl = `/uploads/${newFileName}`;
        
        // 3. Create a message object where the text IS the image URL
        const messageData = {
          id: messageCount++,
          user: currentUsername,
          text: imageUrl, 
          timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
          seen: false
        };

        messagesHistory.push(messageData);
        // 4. Send the message (which contains the URL) to everyone
        io.emit('chat message', messageData);
        console.log(`Image saved and broadcast: ${newFileName}`);
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});