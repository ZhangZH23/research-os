import { Router } from 'express';
import type { ProgramStore } from './program-store';

export function createProgramRouter(program: ProgramStore) {
  const router = Router();
  router.get('/', (_req, res) => res.json(program.state()));
  router.post('/goals', (req, res) => res.status(201).json(program.createGoal(req.body)));
  router.patch('/goals/:id', (req, res) => res.json(program.updateGoal(req.params.id, req.body)));
  router.put('/assessments/:nodeId', (req, res) =>
    res.json(program.saveAssessment(req.params.nodeId, req.body)),
  );
  return router;
}
