require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const fetch = require('node-fetch');
const { RevAiApiClient } = require('revai-node-sdk');
const { AssemblyAI } = require('assemblyai');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static('public'));

const revClient = new RevAiApiClient(process.env.REVA_API_TOKEN);
const assemblyClient = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.post('/transcribe', upload.single('audio'), async (req, res) => {
  const { provider = 'revai', punctuate = 'true' } = req.body;
  const skipPunctuation = punctuate === 'false';
  const audioPath = req.file?.path;

  

  if (!audioPath) {
    console.warn('[POST /transcribe] No audio file received.');
    return res.status(400).send('No audio file uploaded.');
  }

  try {
    let transcript = '';

    if (provider === 'revai') {
      console.log('[Rev.ai] Submitting job...');
      const job = await revClient.submitJobLocalFile(audioPath, {
        skip_punctuation: skipPunctuation,
      });

      const waitForCompletion = async (jobId) => {
        let attempts = 0;
        while (true) {
          const status = await revClient.getJobDetails(jobId);
          console.log(`[Rev.ai] Attempt ${++attempts}: Job status = ${status.status}`);
          if (status.status === 'completed' || status.status === 'transcribed') return status;
          if (status.status === 'failed') throw new Error('Rev.ai transcription failed');
          await new Promise((r) => setTimeout(r, 5000));
        }
      };

      const completedJob = await waitForCompletion(job.id);
      const transcriptData = await revClient.getTranscriptObject(completedJob.id);

      if (transcriptData.monologues && transcriptData.monologues.length > 0) {
        transcriptData.monologues.forEach((mono, index) => {
          const speaker = mono.speaker !== undefined ? `Speaker ${mono.speaker}` : `Speaker ${index}`;
          transcript += `${speaker}: `;
          mono.elements.forEach((el, i) => {
            if (el.type === 'text') {
              transcript += el.value;
              if (mono.elements[i + 1]?.type === 'text') transcript += ' ';
            } else if (el.type === 'punct') {
              transcript += el.value;
              if (mono.elements[i + 1]?.type === 'text') transcript += ' ';
            }
          });
          transcript += '\n\n';
        });
      } else {
        transcript = '[No monologues found]';
      }
    } else if (provider === 'assemblyai') {
      console.log('[AssemblyAI] Uploading file...');
      

      

      const audioStream = fs.createReadStream(audioPath); // path from multer
      // console.log(audioStream);
      const uploadRes = await assemblyClient.files.upload(audioStream); // ✅ uploads to AAI
      console.log(uploadRes);

      const audio_url = uploadRes;

      const transcriptJob = await assemblyClient.transcripts.create({
        audio_url,
        speaker_labels: true,
      });



      if (transcriptJob.utterances && transcriptJob.utterances.length > 0) {
        transcript = transcriptJob.utterances
          .map((u) => `Speaker ${u.speaker}: ${u.text}`)
          .join('\n\n');
      } else {
        transcript = transcriptJob.text || '[No transcript available]';
      }

      // Optional cleanup: delete transcript job from AssemblyAI
      await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptJob.id}`, {
        method: 'DELETE',
        headers: { Authorization: process.env.ASSEMBLYAI_API_KEY },
      });
    } else {
      return res.status(400).json({ error: 'Invalid transcription provider selected.' });
    }

    res.json({ transcript: transcript.trim() });
  } catch (error) {
    console.error('[Error] Transcription failed:', error);
    res.status(500).json({ error: 'Transcription failed.' });
  } finally {
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
