// CORSヘッダ定義（必要ならここにも）
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export class d1_manager {
    constructor(db) {
      this.db = db;
    }
  
    async saveMessage({ text, user, roomId, timestamp }) {
      await this.db.prepare(
        "INSERT INTO chat_memory (original, written_by, written_at, room_id) VALUES (?, ?, ?, ?)"
      ).bind(
        text,
        user,
        new Date(timestamp).toISOString().replace('T', ' ').replace('Z', ''),
        roomId
      ).run();
    }
  }
  