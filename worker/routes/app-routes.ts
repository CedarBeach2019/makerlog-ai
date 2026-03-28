/**
 * MakerLog.ai custom assets and configuration endpoints.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../../src/types.js';
import { getThemeCSS, getRoutingRules, getTemplate } from '../app-config.js';

const appRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Serve theme CSS
appRoutes.get('/theme.css', async (c) => {
  const theme = await getThemeCSS(c.env);
  if (!theme) {
    return c.json({ error: 'Theme not found' }, 404);
  }
  return c.text(theme, 200, { 'Content-Type': 'text/css' });
});

// Get routing rules
appRoutes.get('/rules', async (c) => {
  const rules = await getRoutingRules(c.env);
  return c.json({ rules });
});

// Get template by key
appRoutes.get('/templates/:key', async (c) => {
  const key = c.req.param('key');
  const template = await getTemplate(key, c.env);
  if (!template) {
    return c.json({ error: 'Template not found' }, 404);
  }
  return c.text(template, 200, { 'Content-Type': 'text/markdown' });
});

// List available templates
appRoutes.get('/templates', async (c) => {
  // This would need to be implemented to scan the templates directory
  const templates = [
    { key: 'daily_planning', name: 'Daily Planning', icon: '📅', description: 'Plan your day with priorities, time blocks, and focus areas' },
    { key: 'task_breakdown', name: 'Task Breakdown', icon: '🔧', description: 'Break down complex tasks into manageable subtasks and steps' },
    { key: 'meeting_notes', name: 'Meeting Notes', icon: '📝', description: 'Capture key points, action items, and decisions from meetings' },
    { key: 'retrospective', name: 'Retrospective', icon: '🔄', description: 'Reflect on what went well, what could improve, and next steps' },
    { key: 'goal_setting', name: 'Goal Setting', icon: '🎯', description: 'Define SMART goals with milestones and tracking metrics' },
    { key: 'project_review', name: 'Project Review', icon: '📊', description: 'Review project progress, blockers, and upcoming milestones' },
    { key: 'weekly_sync', name: 'Weekly Sync', icon: '🤝', description: 'Structure weekly team syncs with updates, blockers, and priorities' },
    { key: 'blocker_resolution', name: 'Blocker Resolution', icon: '🚧', description: 'Identify, analyze, and resolve blockers and dependencies' },
  ];
  return c.json({ templates });
});

export default appRoutes;
