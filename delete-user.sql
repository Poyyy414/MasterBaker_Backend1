-- Replace ? with the actual user_id you want to delete
SET @user_id = ?;

-- Delete from child tables first to avoid foreign key constraints
DELETE FROM points_log WHERE user_id = @user_id;
DELETE FROM game_sessions WHERE user_id = @user_id;
DELETE FROM user_badges WHERE user_id = @user_id;
DELETE FROM students WHERE user_id = @user_id;
DELETE FROM teachers WHERE user_id = @user_id;

-- Finally delete from users table
DELETE FROM users WHERE user_id = @user_id;