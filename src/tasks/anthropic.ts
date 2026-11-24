import Anthropic from '@anthropic-ai/sdk';
import { tasksConfig } from '../config.ts';
import { PLAN_INSTRUCTIONS, PLAN_SCHEMA, type PlanInput, type PlanOutput, type Planner } from './planner.ts';
import { TITLE_RULE, type NameInput, type NameOutput, type Namer } from './namer.ts';

// The AI planner for the task triage (CONCEPT.md §2.8, §6): one structured-output call per batch.
// Model, effort and limits — registry/tasks.json; the key — ANTHROPIC_API_KEY in /srv/stream/.env.

// baseURL — only for tests against a fake API.
export function anthropicPlanner(apiKey: string, baseURL?: string): Planner {
  const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const { model, effort, max_tokens } = tasksConfig.ai;
  // Stable part first, so it can be cached: instructions and the task templates.
  const messageRules = tasksConfig.ai.message_rules.map((rule) => `- ${rule}`).join('\n');
  const system = `${PLAN_INSTRUCTIONS}\n\nДействие и контекст:\n${messageRules}\n\nШаблоны задач (name, метка, исполнитель, filed, что сделать):\n${tasksConfig.templates
    .filter((template) => !template.legacy)
    .map((template) => `- ${template.name} ${template.tag ?? '(без метки)'} → ${template.assignee}${template.filed ? ', filed: true' : ''}: ${template.title}. ${template.instruction}`).join('\n')}`;

  return async (input: PlanInput): Promise<PlanOutput> => {
    const { templates, ...batch } = input;
    const response = await client.messages.create({
      model,
      max_tokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: effort as 'low' | 'medium' | 'high', format: { type: 'json_schema', schema: PLAN_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: 'user', content: `Открытые задачи, предыдущие сообщения беседы (context) и новые сообщения (JSON):\n${JSON.stringify(batch)}` }],
    });
    if (response.stop_reason === 'refusal') throw new Error('модель отказалась разбирать пачку');
    if (response.stop_reason === 'max_tokens') throw new Error('ответ модели не уместился в max_tokens');
    const text = response.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') throw new Error('модель не вернула разбор');
    const parsed = JSON.parse(text.text) as Pick<PlanOutput, 'tasks' | 'conversation_only' | 'questions'>;
    if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.conversation_only)) throw new Error('модель вернула неполный разбор');
    return { ...parsed, questions: Array.isArray(parsed.questions) ? parsed.questions : [], usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens } };
  };
}

// Titles of tasks the owner made by hand (namer.ts): one small structured-output call per task.
const NAME_SCHEMA = { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string' } } };
export function anthropicNamer(apiKey: string, baseURL?: string): Namer {
  const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const system = `Ты называешь задачу владельца по её сообщениям. Верни одно название, по-русски.
${TITLE_RULE}`;
  return async (input: NameInput): Promise<NameOutput> => {
    const response = await client.messages.create({
      model: tasksConfig.ai.model, max_tokens: 300,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: NAME_SCHEMA } },
      messages: [{ role: 'user', content: `Задача и её сообщения (JSON):
${JSON.stringify(input)}` }],
    });
    const text = response.content.find((block) => block.type === 'text');
    if (response.stop_reason === 'refusal' || !text || text.type !== 'text') throw new Error('модель не дала названия');
    return { title: (JSON.parse(text.text) as { title: string }).title, usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens } };
  };
}
