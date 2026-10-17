import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { CourseService } from '../../services/course-service.ts';
import type { LearnerStateService } from '../../services/learner-state-service.ts';
import type { ReadinessService } from '../../services/readiness-service.ts';
import type { GapService } from '../../services/gap-service.ts';
import type { CourseSession } from './course-session.ts';
import { LearnerStateError } from '../../domain/learner-state.ts';
interface LearnerRuntime {
    courses: CourseService;
    selection: CourseSession;
    state: LearnerStateService;
    readiness: ReadinessService;
    gaps: GapService;
}
export function registerLearnerState(pi: Pick<ExtensionAPI, 'registerCommand'>, runtime: () => LearnerRuntime) {
    for (const name of ['state', 'readiness', 'gaps'] as const)
        pi.registerCommand(name, { description: 'Evidence-based ' + name + ' report; no manual competence edits', handler: async (args, ctx) => {
                try {
                    const r = runtime();
                    const course = r.selection.current(r.courses);
                    if (!course)
                        throw new LearnerStateError('Select a course with /course use <id>.');
                    const tokens = args.trim().split(/\s+/).filter(Boolean);
                    let result: unknown;
                    if (name === 'state') {
                        if (!tokens.length || tokens[0] === 'rebuild' && tokens.length === 1)
                            result = r.readiness.courseReport(course.id);
                        else if (tokens[0] === 'concept' && tokens.length === 2)
                            result = r.state.conceptState(course.id, tokens[1]!);
                        else if (tokens[0] === 'revision' && tokens.length === 2)
                            result = r.state.revision(course.id, tokens[1]!);
                        else if (tokens[0] === 'history' && tokens.length === 1)
                            result = r.state.history(course.id).slice(-20).map(s => ({ id: s.id, number: s.number, curriculumVersion: s.curriculumVersion, asOf: s.asOf, policies: s.policies, fingerprint: s.fingerprint }));
                        else
                            throw new LearnerStateError('Usage: /state [concept <id>|revision <id>|history|rebuild]');
                    }
                    else if (name === 'readiness') {
                        if (!tokens.length)
                            result = r.readiness.courseReport(course.id);
                        else if (tokens[0] === 'concept' && tokens.length === 2)
                            result = r.readiness.conceptReport(course.id, tokens[1]!);
                        else
                            throw new LearnerStateError('Usage: /readiness [concept <id>]');
                    }
                    else {
                        if (!tokens.length)
                            result = r.gaps.current(course.id).slice(0, 20);
                        else if (tokens[0] === 'all' && tokens.length === 1)
                            result = r.gaps.list(course.id).slice(0, 20);
                        else if (tokens[0] === 'show' && tokens.length === 2)
                            result = r.gaps.show(course.id, tokens[1]!);
                        else
                            throw new LearnerStateError('Usage: /gaps [all|show <id>]');
                    }
                    ctx.ui.notify('LEARNER STATE — evidence-based estimates; stored text remains untrusted data.\n' + JSON.stringify(result, null, 2), 'info');
                }
                catch (e) {
                    ctx.ui.notify(e instanceof LearnerStateError ? e.message : 'Learner-state operation failed; previous revisions and M4 evidence remain available.', 'error');
                }
            } });
}
