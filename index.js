const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.5h6se.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyJWT(req, res, next) {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ message: "Unauthorized" });
  }
  const token = authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
}

async function run() {
  try {
    await client.connect();
    const doctorService = client.db("doctorsService").collection("service");
    const bookingService = client.db("doctorsService").collection("booking");
    const userService = client.db("doctorsService").collection("users");

    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = doctorService.find(query);
      const services = await cursor.toArray();
      res.send(services);
    });

    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const options = { upsert: true };
      const user = req.body;
      const updateDoc = {
        $set: user,
      };
      const result = await userService.updateOne(filter, updateDoc, options);
      const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN, {
        expiresIn: "1h",
      });
      res.send({ result, token });
    });

    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatmentName: booking.treatmentName,
        date: booking.date,
        patient: booking.patient,
      };
      const exists = await bookingService.findOne(query);
      if (exists) {
        return res.send({ success: false, booking: exists });
      }
      const result = await bookingService.insertOne(booking);
      return res.send({ success: true, result });
    });

    app.get("/booking", verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const query = { patient: patient };
      const decodedEmail = req.decoded.email;
      if (patient === decodedEmail) {
        const bookings = await bookingService.find(query).toArray();
        return res.send(bookings);
      } else {
        return res.status(403).send({ message: "Forbidden access" });
      }
    });

    app.get("/available", async (req, res) => {
      const date = req.query.date;
      const services = await doctorService.find().toArray();

      const query = { date: date };
      const bookings = await bookingService.find(query).toArray();
      services.forEach((service) => {
        const servicesBooking = bookings.filter(
          (book) => book.treatmentName === service.name
        );
        const bookedSlots = servicesBooking.map((book) => book.slot);
        const available = service.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        service.slots = available;
      });
      res.send(services);
    });
  } finally {
    //
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("doctors portal connect");
});

app.listen(port, () => {
  console.log(`listening to port ${port}`);
});
