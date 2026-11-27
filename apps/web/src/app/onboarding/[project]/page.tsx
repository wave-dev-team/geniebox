import { ProjectWizard } from '@/widgets/project-onboarding/ui/project-wizard';

export default async function ProjectOnboardingPage({ params }: PageProps<'/onboarding/[project]'>) {
  const { project } = await params;
  return <ProjectWizard slug={project} />;
}
