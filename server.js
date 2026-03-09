const express = require("express");
const multer = require("multer");
const cors = require("cors");
const Tesseract = require("tesseract.js");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const readline = require("readline");
const { google } = require("googleapis");
const vision = require('@google-cloud/vision');
require('dotenv').config();

const client = new vision.ImageAnnotatorClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS 
  
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: "uploads/" });

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const TOKEN_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS_TOKEN;

async function authorize() {
  const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_OATH);
  const { client_secret, client_id, redirect_uris } = credentials.web;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(TOKEN_PATH);
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  }

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES
  });
  console.log("\nOpen this URL in your browser:\n");
  console.log(authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve, reject) => {
    rl.question("\nEnter the code here: ", async (code) => {
      rl.close();
      try {
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
        console.log("Token stored to token.json");
        resolve(oAuth2Client);
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function uploadToDrive(auth, filePath) {
  const drive = google.drive({ version: "v3", auth });
  const fileMetadata = {
    name: "scanned_output_" + Date.now() + ".pdf"
  };
  const media = {
    mimeType: "application/pdf",
    body: fs.createReadStream(filePath)
  };
  const response = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: "id"
  });
  return response.data.id;
}

app.get("/", (req, res) => {
  res.send("Backend is running");
});
// async function extractText(imagePath) {

//   const [result] = await client.textDetection(imagePath);
//   const detections = result.textAnnotations;

//   console.log('Extracted Text:');
//   console.log(detections[0].description);
// return detections[0].description;
// }

app.post("/scan", upload.single("image"), async (req, res) => {
  try {
    console.log("Image received for OCR");
    const result = await Tesseract.recognize(req.file.path, "eng");
    let text = result.data.text;
    res.json({
      extractedText: text
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Text extraction failed"
    });

  }

});
app.post("/upload-drive", async (req, res) => {
let result = {};
  try {
    const { text } = req.body;
    console.log("Creating PDF");
    const pdfPath = "output_" + Date.now() + ".pdf";
    const doc = new PDFDocument();
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);
    doc.fontSize(12).text(text);
    doc.end();
    stream.on("finish", async () => {
      try {
        const auth = await authorize();
        const fileId = await uploadToDrive(auth, pdfPath);
        const driveLink = `https://drive.google.com/file/d/${fileId}/view`;
        result = {
            status :200,
            reason : 'Successfully uploaded to drive.',
            data : driveLink
        }
        res.json(result);
      } catch (err) {
        console.error(err);
        result = {
            status :200,
            reason : err
        }
        res.status(500).json(result);
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message
    });
  }
});
app.get("/oauth2callback", async (req, res) => {
  try {
    const code = req.query.code;
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_OATH);
    const { client_secret, client_id, redirect_uris } = credentials.web;
    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    fs.writeFileSync("token.json", JSON.stringify(tokens));
    res.send("Authentication successful. You can close this tab.");
  } catch (err) {
    console.error(err);
    res.send("Authentication failed");
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port 3000");
});