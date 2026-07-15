const mongoose = require('mongoose');

const uri = "mongodb+srv://anandkumarar2020_db_user:eDdZ09NaS2XciM5L@bsg-cbt-cluster.4atelxi.mongodb.net/bsg_cbt?appName=bsg-cbt-cluster";

async function clearUsers() {
  try {
    await mongoose.connect(uri);
    console.log('Connected to MongoDB');
    
    // The collection name is usually the pluralized lowercase of the model name, so 'users'
    const db = mongoose.connection.db;
    const collection = db.collection('users');
    
    const result = await collection.deleteMany({});
    console.log(`Successfully deleted ${result.deletedCount} users from the database.`);
    
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

clearUsers();
