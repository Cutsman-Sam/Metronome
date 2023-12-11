const express = require('express')
const session = require('express-session');
var bodyParser = require('body-parser')
const mongoose = require('mongoose')

const Schema = mongoose.Schema;
const ObjectId = Schema.ObjectId;

const app = express()
const port = 3000

app.use(express.static('content'))
app.use(session({
    secret: 'your_secret_key', // Secret key for signing the session ID cookie
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS, false for HTTP
}));
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

// MONGOOSE - ORM for NodeJS, MongoDB. Mongoose queries account for the ORM requirement.
const uri = 'mongodb://localhost:27017/metronomedb';
mongoose.connect(uri)
  .then(() => console.log("MongoDB successfully connected"))
  .catch(err => console.error("MongoDB connection error: ", err));

const UserSchema = new Schema({
    userID: String,
    username: String,
    password: String
})

const User = mongoose.model("User", UserSchema)

const gameSchema = new Schema({
    gameID: Number,
    gameName: String,
    clearStates: [String],
    difficultyLevels: [String]
});
const Game = mongoose.model('Game', gameSchema);

const scoreLogSchema = new Schema({
    scoreID: ObjectId, // Mongoose automatically generates this
    userID: String,
    gameID: Number,
    songName: String,
    difficultyLevel: String,
    clearState: String,
    scoreTotal: Number,
    accuracyTotal: String,
    maxChain: Number,
    datePosted: Date
});
const ScoreLog = mongoose.model('ScoreLog', scoreLogSchema);

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/content/index.html')
})

// ORM CODE - Using ORM thru Mongoose
app.post('/create-account', async (req, res) => {
    console.log('Received data:', req.body); // Log the received data

    try {
        const newUser = new User(req.body);
        const savedUser = await newUser.save();
        console.log('Saved user:', savedUser); // Log the saved user
        res.status(201).json({ message: 'Account created!' });
    } catch (error) {
        console.error('Error creating account:', error);
        res.status(500).json({ message: 'Error creating account', error: error.toString() });
    }
});

app.post('/login', async (req, res) => {
    try {
        const user = await User.findOne({ userID: req.body.userid }).exec();
        if (!user) {
            return res.status(401).send('User does not exist');
        }

        if (req.body.password === user.password) {
            req.session.userId = user.userID;
            req.session.username = user.username;
            res.redirect('index.html');
        } else {
            // Passwords don't match
            res.status(401).send('Password is incorrect');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/submit-score', async (req, res) => {
    const session = await mongoose.startSession();
    // START TRANSACTION - atomic addition to score data
    // MongoDB uses a snapshot isolation level by default.
    session.startTransaction();
    try {
        const userID = req.session.userId;
        const newScoreLog = new ScoreLog({
            ...req.body,
            userID: userID,
        });

        await newScoreLog.save();
        // COMMIT TRANSACTION - successful addition to table
        await session.commitTransaction();
        res.status(201).json({ message: 'Score submitted successfully!' });
    } catch (error) {
        // ABORT TRANSACTION - unsuccessful addition to table
        await session.abortTransaction();
        res.status(500).json({ message: 'Error submitting score', error: error });
    }
    session.endSession();
});

app.get('/check-login', (req, res) => {
    if (req.session.userId) {
        res.json({ isLoggedIn: true });
    } else {
        res.json({ isLoggedIn: false });
    }
});

app.get('/fetch-games', async (req, res) => {
    try {
        const games = await Game.find({}); // Fetch all games
        res.json(games);
    } catch (error) {
        res.status(500).send('Error fetching games');
    }
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})

app.get('/get-current-user', (req, res) => {
    if (req.session && req.session.userId) {
        res.json({
            userID: req.session.userId,
            username: req.session.username
        });
    } else {
        res.status(401).json({ message: 'User not logged in' });
    }
});

app.post('/update-account', async (req, res) => {
    let session;
    try {
        const { newUsername, newPassword } = req.body;
        const currentUserId = req.session.userId;
        console.log('Current User ID:', currentUserId);
        console.log('New Username:', newUsername);
        console.log('New Password:', newPassword);

        // Check if the current user exists
        const existingUser = await User.findOne({ userID: currentUserId }).session(session);
        if (!existingUser) {
            throw new Error('User not found');
        }

        // Update user information
        const updatedUser = await User.findOneAndUpdate(
            { userID: currentUserId },
            { username: newUsername, password: newPassword },
            { new: true, session }
        );
        if (!updatedUser) {
            throw new Error('User update failed');
        }
        req.session.username = updatedUser.username;
        console.log('User updated:', updatedUser);

        // Update dependent scores of the user
        const updateResult = await ScoreLog.updateMany(
            { userID: currentUserId },
            { username: newUsername },
            { session }
        );
        console.log('ScoreLog update result:', updateResult);

        console.log('Transaction committed');
        res.status(200).json({ message: 'Account updated successfully' });
    } catch (error) {
        console.error('Error during transaction:', error);
        if (session && session.inTransaction()) {
            console.log('Transaction aborted');
        }
        res.status(500).json({ message: 'Error updating account', error: error.toString() });
    }
});

app.post('/delete-account', async (req, res) => {
    const session = await mongoose.startSession();
    //session.startTransaction();

    try {
        const currentUserId = req.session.userId;

        if (!currentUserId) {
            throw new Error('User not logged in');
        }

        // Delete user account
        const userDeletionResult = await User.deleteOne({ userID: currentUserId }).session(session);

        if (userDeletionResult.deletedCount === 0) {
            throw new Error('User account not found');
        }

        // Delete associated score logs
        const scoreLogDeletionResult = await ScoreLog.deleteMany({ userID: currentUserId }).session(session);

        console.log('User account and associated score logs deleted.');

        //await session.commitTransaction();

        req.session.destroy(); // Destroy the session after account deletion

        res.status(200).json({ message: 'Account and associated data deleted successfully.' });
    } catch (error) {
        console.error('Error during deletion:', error);
        //await session.abortTransaction();
        res.status(500).json({ message: 'Error deleting account', error: error.toString() });
    } //finally {
        //session.endSession();
    //}
});

// STORED PROCEDURE CODE - MongoDB Aggregation Pipeline
app.get('/fetch-scores', async (req, res) => {
    try {
        let query = {};
        if (req.query.player) {
            const user = await User.findOne({ username: req.query.player });
            if (user) query.userID = user.userID;
        }
        if (req.query.game) {
            const game = await Game.findOne({ gameName: req.query.game });
            if (game) query.gameID = game.gameID;
        }
        if (req.query.song) {
            query.songName = req.query.song;
        }
        if (req.query.date) {
            const startDate = new Date(req.query.date);
            startDate.setUTCHours(0, 0, 0, 0); // Set start of the day in UTC

            const endDate = new Date(startDate);
            endDate.setUTCHours(23, 59, 59, 999); // Set end of the day in UTC

            query.datePosted = { $gte: startDate, $lt: endDate };
        }

        // Adjust the aggregation query accordingly
        const scoreLogs = await ScoreLog.aggregate([
            {
                $lookup: {
                    from: 'users', // the name of your users collection in MongoDB
                    localField: 'userID', // the field in the score logs collection
                    foreignField: 'userID', // the field in the users collection
                    as: 'userInfo' // the name of the new array field to add to the result
                }
            },
            {
                $unwind: '$userInfo' // Optional: Flattens the userInfo field
            },
            {
                $match: query
            },
            {
                $lookup: {
                    from: 'games', // the name of your games collection in MongoDB
                    localField: 'gameID', // the field in the score logs collection
                    foreignField: 'gameID', // the field in the games collection
                    as: 'gameInfo' // the name of the new array field to add to the result
                }
            },
            {
                $unwind: '$gameInfo' // Optional: Flattens the gameInfo field
            }
        ]);
        res.json(scoreLogs); // Send score logs back as JSON
    } catch (error) {
        res.status(500).send('Error fetching score logs');
    }
});