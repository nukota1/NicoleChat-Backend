CREATE TABLE chat_memory (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  original TEXT NOT NULL,
  summary TEXT,
  room_id TEXT,
  written_by TEXT,
  written_at DATETIME
);