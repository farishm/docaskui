React Front end for DocAskAPI which is a ASP.NET Core Web API for AI-powered chat, document question answering, and agent workflows.

It integrates Azure OpenAI for chat completions and embeddings, Azure AI Search for vector
retrieval, and Semantic
Kernel for agent orchestration and function calling. It also supports conversation memory,
code-focused prompts,
and Server-Sent Events (SSE) so clients can receive responses incrementally.

Core document workflow
1. The client uploads a PDF using the Documents upload endpoint.
2. The API validates the file and extracts page text with PdfPig.
3. Text is split into overlapping chunks so sentences are less likely to be cut in half.
4. Azure OpenAI generates an embedding for each chunk.
5. Chunks, embeddings, file names, document IDs, and page numbers are stored in Azure AI
Search.
6. A question is embedded and matched against the most relevant chunks using vector search.
7. Retrieved context is sent to Azure OpenAI, which generates a grounded answer with source
citations.

## Deployment

The production frontend sends API requests to the Azure API host configured in `src/api.ts`.
Set `VITE_API_BASE_URL` in the frontend build environment to override that host. Configure
the API's CORS policy to allow the deployed Static Web App origin. Local development keeps
using the Vite `/api` proxy.

Agent workflow
The AgentV1 implementation gives Azure OpenAI tools for listing documents, searching
documents, and calculations.
The model can select tools, receive their results, and produce a final answer. Tool calls
and answer tokens can
be streamed to the client. The agent has maximum step and tool-call limits to prevent
runaway execution.
Document content is treated as untrusted data to reduce prompt-injection risk. A
development-only red-team endpoint
exercises prompt extraction, forged messages, poisoned PDFs, and tool-spam scenarios.