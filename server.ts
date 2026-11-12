import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Initialize Gemini client if API key is present
const apiKey = process.env.GEMINI_API_KEY;
let aiClient: GoogleGenAI | null = null;

if (apiKey && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.trim().length > 0) {
  aiClient = new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// 1. Health check & configuration status
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    geminiConfigured: !!aiClient,
    model: 'gemini-3.8-flash',
    timestamp: new Date().toISOString(),
  });
});

// 2. AI Engineering Mentor Endpoint
app.post('/api/ai/mentor', async (req, res) => {
  const { message, branch, topic } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  // If Gemini client is configured, call Gemini 3.8 Flash
  if (aiClient) {
    try {
      const systemInstruction = `You are PathPilot AI Engineering Mentor, an inspiring engineering professor and senior technical lead.
The student is in: ${branch || 'Engineering'}, currently studying: ${topic || 'Core Engineering'}.
Your goals:
1. Explain difficult engineering concepts in simple, intuitive language using real-world analogies.
2. Provide clean, well-commented code snippets or technical formulas when relevant.
3. Highlight common pitfalls and engineering edge cases.
4. Conclude with a quick 1-sentence practice reflection question or challenge.
Format with clean Markdown, clear headings, and code blocks.`;

      const response = await aiClient.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: message,
        config: {
          systemInstruction,
        },
      });

      const reply = response.text || 'I could not generate an answer right now. Please try again.';
      return res.json({
        reply,
        isRealAi: true,
        model: 'gemini-3.8-flash',
      });
    } catch (err: unknown) {
      console.error('Gemini API Error:', err);
      // Fallback gracefully with error transparency
      return res.json({
        reply: getCuratedMentorFallback(message, branch),
        isRealAi: false,
        model: 'curated-fallback',
        apiErrorNotice: 'Live AI request encountered a rate limit or timeout. Showing curated engineering mentor guidance.',
      });
    }
  }

  // Fallback when no Gemini API key is configured
  return res.json({
    reply: getCuratedMentorFallback(message, branch),
    isRealAi: false,
    model: 'curated-fallback',
    apiErrorNotice: 'Gemini API key is not yet configured in Settings > Secrets. Providing verified engineering response from PathPilot knowledge base.',
  });
});

// 3. AI Assessment Question Generator Endpoint
app.post('/api/ai/generate-assessment', async (req, res) => {
  const { subject, topic, branch } = req.body;

  if (aiClient) {
    try {
      const prompt = `Generate 4 rigorous multiple-choice questions for engineering students on the topic "${topic}" in "${subject}" (${branch || 'Engineering'}).
Each question must test conceptual understanding, edge cases, or runtime complexity. Provide 4 options, the zero-based index of the correct answer, a detailed explanation, and a specific concept tag.`;

      const response = await aiClient.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                subjectId: { type: Type.STRING },
                topic: { type: Type.STRING },
                question: { type: Type.STRING },
                codeSnippet: { type: Type.STRING },
                options: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                correctAnswer: { type: Type.INTEGER },
                explanation: { type: Type.STRING },
                difficulty: { type: Type.STRING },
                conceptTag: { type: Type.STRING },
              },
              required: ['question', 'options', 'correctAnswer', 'explanation', 'difficulty', 'conceptTag'],
            },
          },
        },
      });

      const text = response.text;
      if (text) {
        const questions = JSON.parse(text);
        const formatted = questions.map((q: any, idx: number) => ({
          id: `gen-${Date.now()}-${idx}`,
          subjectId: subject || 'eng-subject',
          topic: topic || 'Engineering',
          question: q.question,
          codeSnippet: q.codeSnippet || undefined,
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          difficulty: q.difficulty || 'Intermediate',
          conceptTag: q.conceptTag || topic || 'Concept',
        }));
        return res.json({ questions: formatted, isRealAi: true });
      }
    } catch (err) {
      console.error('Error generating AI assessment:', err);
    }
  }

  // Fallback to deterministic curated questions
  return res.json({
    questions: null,
    isRealAi: false,
    message: 'Using verified PathPilot question bank for this module.',
  });
});

// 4. AI Diagnostic Analysis Endpoint
app.post('/api/ai/diagnostic-analysis', async (req, res) => {
  const { topic, branch, missedDetails } = req.body;

  if (aiClient && topic) {
    try {
      const prompt = `Perform an engineering diagnostic gap analysis for a student struggling with "${topic}" in "${branch}".
Missed question details: ${JSON.stringify(missedDetails || 'Multiple conceptual errors on fundamentals')}.
Provide:
1. 3 specific technical misconceptions detected from these errors.
2. 3 foundational gaps they must review.
3. A 3-step structured remediation plan with estimated minutes and specific study action.
4. One quick code or mental practice challenge with solution insight.`;

      const response = await aiClient.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              misconceptionsDetected: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              foundationalGaps: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              remediationPlan: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    stepNumber: { type: Type.INTEGER },
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    recommendedResource: { type: Type.STRING },
                    estimatedMinutes: { type: Type.INTEGER },
                  },
                },
              },
              quickPracticeChallenge: {
                type: Type.OBJECT,
                properties: {
                  prompt: { type: Type.STRING },
                  codeTemplate: { type: Type.STRING },
                  solutionInsight: { type: Type.STRING },
                },
              },
            },
          },
        },
      });

      const text = response.text;
      if (text) {
        const parsed = JSON.parse(text);
        return res.json({
          report: {
            id: `diag-${Date.now()}`,
            subject: branch,
            topic,
            overallScore: 45,
            ...parsed,
            generatedAt: new Date().toISOString(),
            isAiGenerated: true,
          },
          isRealAi: true,
        });
      }
    } catch (err) {
      console.error('Error in diagnostic analysis API:', err);
    }
  }

  return res.json({
    report: null,
    isRealAi: false,
    message: 'Using PathPilot verified diagnostic blueprints.',
  });
});

// Helper for curated responses
function getCuratedMentorFallback(query: string, branch?: string): string {
  const q = query.toLowerCase();

  if (q.includes('dijkstra') || q.includes('a*') || q.includes('pathfinding')) {
    return `### Dijkstra's vs A* Pathfinding: Engineering Breakdown

**Dijkstra's Algorithm** is an **uninformed search** algorithm. It expands outward in concentric rings of equal distance from the source using a Priority Queue (min-heap), guaranteeing the shortest path in non-negative weighted graphs with time complexity **$O((V + E) \\log V)$**.

**A\\* Search** is an **informed (heuristic) search** algorithm. It evaluates nodes by:
$$f(n) = g(n) + h(n)$$
- **$g(n)$**: Exact cost from the start node to node $n$.
- **$h(n)$**: Admissible (never overestimates) and consistent heuristic estimating cost from $n$ to goal (e.g., Euclidean or Manhattan distance).

\`\`\`python
import heapq

def a_star(graph, start, goal, heuristic):
    open_set = [(0, start)]
    g_score = {start: 0}
    
    while open_set:
        f, current = heapq.heappop(open_set)
        if current == goal:
            return g_score[goal]
            
        for neighbor, weight in graph[current]:
            tentative_g = g_score[current] + weight
            if tentative_g < g_score.get(neighbor, float('inf')):
                g_score[neighbor] = tentative_g
                f_score = tentative_g + heuristic(neighbor, goal)
                heapq.heappush(open_set, (f_score, neighbor))
    return float('inf')
\`\`\`

**Key Takeaway**: Dijkstra searches blindly in all directions. A* focuses its search toward the target like a flashlight, pruning massive amounts of state space.

*Challenge*: What happens to A* if $h(n) = 0$ everywhere? (Hint: It degenerates into Dijkstra's algorithm!)`;
  }

  if (q.includes('virtual memory') || q.includes('page table') || q.includes('paging')) {
    return `### Virtual Memory & Multi-Level Page Tables

In modern operating systems, programs operate in a **Virtual Address Space**, isolated from physical RAM.

#### Why We Need Virtual Memory:
1. **Isolation & Protection**: Process A cannot accidentally overwrite or snoop on Process B's memory.
2. **Illusion of Infinite Memory**: Inactive pages are swapped to NVMe/disk (demand paging), allowing workloads larger than physical DRAM.
3. **Contiguous Allocation for User Space**: The compiler sees a contiguous address space from $0x0000$ to $0x7FFF...$, even if physical frames are scattered across fragmented RAM.

\`\`\`
Virtual Address (64-bit x86-64):
+---------+---------+---------+---------+------------+
| PML4    | Directory | Mid-Dir | Table   | Offset     |
| (9 bits)| (9 bits)  | (9 bits)| (9 bits)| (12 bits)  |
+---------+---------+---------+---------+------------+
\`\`\`

**Hardware Acceleration (TLB)**:
Because traversing 4 levels of page tables takes 4 memory accesses per pointer dereference, CPUs use a **Translation Lookaside Buffer (TLB)**—an ultra-fast content-addressable cache with hit rates $>98\\%$.

*Challenge*: What causes a "TLB shootdown" in multi-core systems? (Hint: When one core invalidates a shared page mapping across other cores' caches!)`;
  }

  if (q.includes('raft') || q.includes('consensus') || q.includes('cap')) {
    return `### Distributed Consensus: The Raft Algorithm

Raft achieves distributed consensus by electing a single distinguished **Leader**, which has complete authority over the replicated log.

#### Three Subproblems in Raft:
1. **Leader Election**: Heartbeats via \`AppendEntries\` RPCs prevent followers from timing out. If an election timer expires (150-300ms randomized), a node transitions to **Candidate** and requests votes.
2. **Log Replication**: The leader receives commands from clients, appends them to its log, and broadcasts them. Once replicated on a **quorum** ($\\lfloor N/2 \\rfloor + 1$ nodes), the entry is committed.
3. **Safety**: A candidate can only be elected if its log is at least as up-to-date as the majority of voters (\`lastLogIndex\` and \`lastLogTerm\`).

\`\`\`
Client -> [ Leader (Term 2) ] ===(AppendEntries)===> [ Follower 1 ] (ACK)
                              ===(AppendEntries)===> [ Follower 2 ] (ACK)
                               Quorum Reached -> Commit & Apply to State Machine
\`\`\`

*Challenge*: How does randomized election timeout prevent split-vote deadlocks in Raft?`;
  }

  return `### Engineering Insight: ${branch || 'Core Concepts'}

Engineering mastery requires connecting abstract mathematics with physical or software systems:

1. **First Principles Thinking**: Break down complex specifications into fundamental laws (Kirchhoff's laws, Conservation of Energy, Asymptotic Complexity, Amdahl's Law).
2. **System Trade-offs**: In engineering, there are no optimal solutions—only trade-offs. Latency vs. Throughput, Consistency vs. Availability (CAP), Speed vs. Power consumption.
3. **Rigorous Verification**: Always verify boundary conditions (empty buffers, null pointers, resonant frequencies, thermal expansion limits).

Would you like to examine a concrete code implementation, analyze a runtime proof, or run a diagnostic practice quiz on this topic?`;
}

// Development vs Production serving
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    // Vite middleware in dev
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Static files in production
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PathPilot Server running on http://0.0.0.0:${PORT}`);
    console.log(`Gemini API configured: ${!!aiClient}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
