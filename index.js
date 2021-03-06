const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
var nodemailer = require("nodemailer");
var sgTransport = require("nodemailer-sendgrid-transport");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.SECRET_KEY_STRIPE);
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

var options = {
  auth: {
    api_key: process.env.EMAIL_SENDER,
  },
};
var mailer = nodemailer.createTransport(sgTransport(options));

function sendAppointmentEmail(booking) {
  const { patient, patientName, date, slot, treatmentName } = booking;
  var email = {
    to: patient,
    from: process.env.EMAIL_SENDER_ID,
    subject: `Your appointment for ${treatmentName} is on ${date} at ${slot} is confirmed`,
    text: `Your appointment for ${treatmentName} is on ${date} at ${slot} is confirmed`,
    html: `
    <div>
      <h2>Your appointment for ${treatmentName}</h2>
      <p>${date}</p>
      <p>${slot}</p>
      <p>Our address</p>
      <p>andor khali bandorban</p>
      <p>confirmed your booking</p>
      <a href="https://www.linkedin.com/feed/?trk=homepage-basic_google-one-tap-submit">please follow me</a>
    </div>
    `,
  };

  mailer.sendMail(email, function (err, res) {
    if (err) {
      console.log(err);
    }
    console.log(res);
  });
}

async function run() {
  try {
    await client.connect();
    const doctorService = client.db("doctorsService").collection("service");
    const bookingService = client.db("doctorsService").collection("booking");
    const userService = client.db("doctorsService").collection("users");
    const addDoctor = client.db("doctorsService").collection("doctors");
    const paymentUser = client.db("doctorsService").collection("payment");

    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await userService.findOne({ email: requester });
      if (requesterAccount.role === "admin") {
        next();
      } else {
        return res.status(403).send({ message: "Forbidden access" });
      }
    };

    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = doctorService.find(query).project({ name: 1 });
      const services = await cursor.toArray();
      res.send(services);
    });

    app.get("/users", verifyJWT, async (req, res) => {
      const users = await userService.find().toArray();
      res.send(users);
    });

    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userService.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send({ admin: isAdmin });
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

    app.put("/user/admin/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updateDoc = {
        $set: { role: "admin" },
      };
      const result = await userService.updateOne(filter, updateDoc);
      return res.send(result);
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
      sendAppointmentEmail(booking);
      return res.send({ success: true, result });
    });

    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const service = req.body;
      const price = service.price;
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
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

    app.get("/booking/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await bookingService.findOne(query);
      res.send(result);
    });

    app.patch("/booking/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const payment = req.body;
      const updateDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };
      const updateBooking = await bookingService.updateOne(filter, updateDoc);

      const result = await paymentUser.insertOne(payment);
      res.send(updateDoc);
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

    app.post("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await addDoctor.insertOne(doctor);
      res.send(result);
    });

    app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await addDoctor.find().toArray();
      res.send(result);
    });

    app.delete("/doctors/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const result = await addDoctor.deleteOne(filter);
      res.send(result);
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
