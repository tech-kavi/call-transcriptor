require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { RevAiApiClient } = require('revai-node-sdk');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

app.use(express.static('public'));

console.log('[Server] Rev.ai token loaded:', !!process.env.REVA_API_TOKEN);

const client = new RevAiApiClient(process.env.REVA_API_TOKEN);

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    console.warn('[POST /transcribe] No audio file received.');
    return res.status(400).send('No audio file uploaded.');
  }

  const audioPath = req.file.path;
  console.log(`[POST /transcribe] Received file: ${audioPath}`);

  try {
    console.log('[Rev.ai] Submitting job...');
    const job = await client.submitJobLocalFile(audioPath);
    console.log(`[Rev.ai] Job submitted: ${job.id}`);

    const waitForCompletion = async (jobId) => {
      let attempts = 0;
      while (true) {
        const status = await client.getJobDetails(jobId);
        console.log(`[Rev.ai] Attempt ${++attempts}: Job status = ${status.status}`);

        if (status.status === 'completed' || status.status === 'transcribed') {
          console.log('[Rev.ai] Job ready for transcript.');
          return status;
        }

        if (status.status === 'failed') {
          console.error('[Rev.ai] Job failed.');
          throw new Error('Transcription job failed');
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    };

    const completedJob = await waitForCompletion(job.id);

    console.log('[Rev.ai] Fetching transcript...');
    const transcriptData = await client.getTranscriptObject(completedJob.id);
    console.log('[Rev.ai] Transcript fetched.');

    // Build transcript with speakers
    let finalTranscript = '';
if (transcriptData.monologues && transcriptData.monologues.length > 0) {
  transcriptData.monologues.forEach((mono, index) => {
    const speaker = mono.speaker !== undefined ? `Speaker ${mono.speaker}` : `Speaker ${index}`;
    finalTranscript += `${speaker}: `;

    mono.elements.forEach((el, i) => {
      if (el.type === 'text') {
        finalTranscript += el.value;
        // Add a space if next element is text (not punctuation)
        if (mono.elements[i + 1] && mono.elements[i + 1].type === 'text') {
          finalTranscript += ' ';
        }
      } else if (el.type === 'punct') {
        // Add punctuation directly without space before it
        finalTranscript += el.value;
        // Add a space after punctuation if next is text (optional)
        if (mono.elements[i + 1] && mono.elements[i + 1].type === 'text') {
          finalTranscript += ' ';
        }
      }
    });

    finalTranscript += '\n\n';
  });
} else {
  finalTranscript = '[No monologues found]';
}


    res.json({ transcript: finalTranscript.trim() });
  } catch (error) {
    console.error('[Error] Transcription failed:', error);
    res.status(500).json({ error: 'Transcription failed.' });
  } finally {
    // Always delete the file
    try {
      fs.unlinkSync(audioPath);
      console.log(`[Cleanup] Deleted temp file: ${audioPath}`);
    } catch (e) {
      console.warn(`[Cleanup] Failed to delete file: ${audioPath}`);
    }
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Server] Running on port ${PORT}`));
