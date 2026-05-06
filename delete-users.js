require('dotenv').config();
const db = require('./config/db');

const userIdsToDelete = [1, 2, 8, 9, 10, 13, 14, 15, 16, 17, 18, 19];

async function deleteUsers() {
  try {
    const placeholders = userIdsToDelete.map(() => '?').join(',');
    const query = `DELETE FROM users WHERE user_id IN (${placeholders})`;

    const [result] = await db.execute(query, userIdsToDelete);

    console.log(`Deleted ${result.affectedRows} users successfully.`);
  } catch (error) {
    console.error('Error deleting users:', error);
  } finally {
    process.exit();
  }
}

deleteUsers();