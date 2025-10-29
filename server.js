const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');
const url = require('url');

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('Error: STRIPE_SECRET_KEY is not set.');
  process.exit(1);
}
if (!process.env.STRIPE_PUBLISHABLE_KEY) {
  console.error('Error: STRIPE_PUBLISHABLE_KEY is not set.');
  process.exit(1);
}
if (!process.env.EMAIL_PASSWORD) {
  console.error('Error: EMAIL_PASSWORD is not set.');
  process.exit(1);
}
if (!process.env.FRONTEND_URL) {
  console.error('Error: FRONTEND_URL is not set.');
  process.exit(1);
}

const FRONTEND_URL = process.env.FRONTEND_URL;
try {
  new url.URL(FRONTEND_URL);
} catch (error) {
  console.error(`Error: Invalid FRONTEND_URL (${FRONTEND_URL})`);
  process.exit(1);
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY, {
  maxNetworkRetries: 3,
  timeout: 20000,
});

const transporter = nodemailer.createTransport({
  host: 'smtp.hostinger.com',
  port: 587,
  secure: false,
  auth: {
    user: 'info@clearautocheck.com',
    pass: process.env.EMAIL_PASSWORD,
  },
});

// Middleware
app.use(express.json());
app.use(helmet()); 
app.use(
  cors({
    origin: '*', 
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
  })
);

app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.get('/api/config', (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

app.post('/api/create-checkout-session', async (req, res) => {
  console.log('Received request:', req.body, 'Origin:', req.get('Origin')); // Debug log
  const { vehicleIdentifier, fullName, email, phone, country, state } = req.body;

  try {
    if (!vehicleIdentifier || !fullName || !email || !country) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const successUrl = `${FRONTEND_URL}/?payment=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${FRONTEND_URL}/?payment=canceled`;

    try {
      new url.URL(successUrl.replace('{CHECKOUT_SESSION_ID}', 'test'));
      new url.URL(cancelUrl);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Vehicle Check Report',
              description: `Vehicle Check for ${vehicleIdentifier}`,
            },
            unit_amount: 2000, // $10.00
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: email,
      metadata: {
        vehicleIdentifier,
        fullName,
        phone: phone || '',
        country,
        state: state || '',
      },
    });

    res.json({ id: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

app.get('/api/checkout-session', async (req, res) => {
  const { sessionId } = req.query;

  try {
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === 'paid') {
      const { vehicleIdentifier, fullName, phone, country, state } = session.metadata;
      const customerEmail = session.customer_email;

      // New user confirmation email content
      const userConfirmationEmailContent = `
        <p>Dear ${fullName},</p>
        
        <p>Thank you for purchasing the Clear Auto Check Report. We appreciate your trust in our service.</p>
        
        <p>We are currently working on your report, and you can expect to receive it within the next 24 hours. Our team is making sure all the details are accurate and complete to help you make an informed decision.</p>
        
        <p>If you have any questions in the meantime, feel free to reach out.</p>
        
        <p>Best regards,<br>
        Clear Auto Check</p>
      `;

      // Admin notification email content
      const adminEmailContent = `
        <h2>New Vehicle Check Request</h2>
        <p>A user has paid for a vehicle check:</p>
        <ul>
          <li><strong>Vehicle Identifier</strong>: ${vehicleIdentifier}</li>
          <li><strong>Full Name</strong>: ${fullName}</li>
          <li><strong>Email</strong>: ${customerEmail}</li>
          <li><strong>Phone</strong>: ${phone || 'Not provided'}</li>
          <li><strong>Country</strong>: ${country}</li>
          <li><strong>State/Province</strong>: ${state || 'Not provided'}</li>
          <li><strong>Payment Amount</strong>: $${(session.amount_total / 100).toFixed(2)} USD</li>
          <li><strong>Session ID</strong>: ${sessionId}</li>
        </ul>
        <p>Please process the report.</p>
      `;

      const userMailOptions = {
        from: 'Clear Auto Check <info@clearautocheck.com>',
        to: customerEmail,
        subject: 'Your Vehicle Check Report Order Confirmation',
        html: userConfirmationEmailContent,
      };

      const adminMailOptions = {
        from: 'Clear Auto Check <info@clearautocheck.com>',
        to: 'info@clearautocheck.com',
        subject: 'New Vehicle Check Request',
        html: adminEmailContent,
      };

      await Promise.all([
        transporter.sendMail(userMailOptions),
        transporter.sendMail(adminMailOptions),
      ]);
    }

    res.json(session);
  } catch (error) {
    console.error('Error retrieving checkout session:', error.message);
    res.status(500).json({ error: 'Failed to retrieve checkout session' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
