import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PLC_TASKS = [
  { step: 1, code: 'PLC_STEP_01', title: 'Review Control Philosophy / Functional Requirements', seniority: 'SENIOR', days: 2, depends: null },
  { step: 2, code: 'PLC_STEP_02', title: 'Verify I/O List and Tag List as per Approved Documents', seniority: 'JUNIOR', days: 2, depends: null },
  { step: 3, code: 'PLC_STEP_03', title: 'Verify PLC Hardware Configuration as per Electrical Dwg', seniority: 'JUNIOR', days: 1, depends: null },
  { step: 4, code: 'PLC_STEP_04', title: 'Verify PLC CPU, Comm Modules & Network Configuration', seniority: 'SENIOR', days: 1, depends: null },
  { step: 5, code: 'PLC_STEP_05', title: 'DI Mapping', seniority: 'JUNIOR', days: 2, depends: null },
  { step: 6, code: 'PLC_STEP_06', title: 'DQ Mapping', seniority: 'JUNIOR', days: 2, depends: null },
  { step: 7, code: 'PLC_STEP_07', title: 'Analog Input Scaling, Engineering Units & Range Settings', seniority: 'JUNIOR', days: 2, depends: null },
  { step: 8, code: 'PLC_STEP_08', title: 'Analog Output / PID Control Logic', seniority: 'SENIOR', days: 3, depends: null },
  { step: 9, code: 'PLC_STEP_09', title: 'Motor Control Logic, Faceplate, Alarms & Animation', seniority: 'SENIOR', days: 3, depends: null },
  { step: 10, code: 'PLC_STEP_10', title: 'Valve Control Logic, Faceplate, Alarms & Animation', seniority: 'SENIOR', days: 2, depends: null },
  { step: 11, code: 'PLC_STEP_11', title: 'Auto Sequence Complete', seniority: 'SENIOR', days: 4, depends: null },
  { step: 12, code: 'PLC_STEP_12', title: 'Simulation Trial of Manual Function', seniority: 'JUNIOR', days: 2, depends: null },
  { step: 13, code: 'PLC_STEP_13', title: 'Simulation with Auto sequence trial and SCADA/HMI', seniority: 'SENIOR', days: 3, depends: null, isSim: true },
];

const SCADA_TASKS = [
  { step: 1, code: 'SCADA_STEP_01', title: 'Review P&ID and requirement', seniority: 'SENIOR', days: 2, depends: null },
  { step: 2, code: 'SCADA_STEP_02', title: 'Diagnostic Screen of DI', seniority: 'JUNIOR', days: 1, depends: null },
  { step: 3, code: 'SCADA_STEP_03', title: 'Diagnostic Screen of DQ', seniority: 'JUNIOR', days: 1, depends: null },
  { step: 4, code: 'SCADA_STEP_04', title: 'Diagnostic Screen of AI', seniority: 'JUNIOR', days: 1, depends: null },
  { step: 5, code: 'SCADA_STEP_05', title: 'Diagnostic Screen of AQ', seniority: 'JUNIOR', days: 1, depends: null },
  { step: 6, code: 'SCADA_STEP_06', title: 'Scaling Screen of Analog parameter', seniority: 'JUNIOR', days: 2, depends: null },
  { step: 7, code: 'SCADA_STEP_07', title: 'Faceplate Development', seniority: 'SENIOR', days: 3, depends: null },
  { step: 8, code: 'SCADA_STEP_08', title: 'Alarm + History development', seniority: 'SENIOR', days: 2, depends: null },
  { step: 9, code: 'SCADA_STEP_09', title: 'Trend development', seniority: 'JUNIOR', days: 2, depends: null },
  { step: 10, code: 'SCADA_STEP_10', title: 'P&ID Developed without tag', seniority: 'JUNIOR', days: 3, depends: null },
  { step: 11, code: 'SCADA_STEP_11', title: 'P&ID developed with Tag Complete', seniority: 'SENIOR', days: 3, depends: null },
  { step: 12, code: 'SCADA_STEP_12', title: 'Communication Architect', seniority: 'SENIOR', days: 2, depends: null },
  { step: 13, code: 'SCADA_STEP_13', title: 'Simulation Trial', seniority: 'SENIOR', days: 3, depends: null, isSim: true },
];

const HMI_TASKS = [
  { step: 1, code: 'HMI_STEP_01', title: 'Review P&ID and HMI screen requirements', seniority: 'SENIOR', days: 2, depends: null },
  { step: 2, code: 'HMI_STEP_02', title: 'Diagnostic Screen of DI', seniority: 'JUNIOR', days: 1, depends: null },
  { step: 3, code: 'HMI_STEP_03', title: 'Diagnostic Screen of DQ', seniority: 'JUNIOR', days: 1, depends: null },
  { step: 4, code: 'HMI_STEP_04', title: 'Diagnostic Screen of AI', seniority: 'JUNIOR', days: 1, depends: null },
  { step: 5, code: 'HMI_STEP_05', title: 'Diagnostic Screen of AQ', seniority: 'JUNIOR', days: 1, depends: null },
  { step: 6, code: 'HMI_STEP_06', title: 'Scaling Screen of Analog parameter', seniority: 'JUNIOR', days: 2, depends: null },
  { step: 7, code: 'HMI_STEP_07', title: 'Faceplate Development', seniority: 'SENIOR', days: 3, depends: null },
  { step: 8, code: 'HMI_STEP_08', title: 'Alarm + History development', seniority: 'SENIOR', days: 2, depends: null },
  { step: 9, code: 'HMI_STEP_09', title: 'Trend development', seniority: 'JUNIOR', days: 2, depends: null },
  { step: 10, code: 'HMI_STEP_10', title: 'Screen Navigation & Layouts', seniority: 'JUNIOR', days: 2, depends: null },
  { step: 11, code: 'HMI_STEP_11', title: 'HMI Tag Linking with PLC DBs', seniority: 'SENIOR', days: 3, depends: null },
  { step: 12, code: 'HMI_STEP_12', title: 'Communication Configuration & Drivers', seniority: 'SENIOR', days: 1, depends: null },
  { step: 13, code: 'HMI_STEP_13', title: 'Simulation Trial', seniority: 'SENIOR', days: 2, depends: null, isSim: true },
];

async function main() {
  console.log('Seeding Checklist Templates...');

  const templates = [
    {
      code: 'PLC',
      name: 'PLC Programming + Simulation',
      description: 'Standard 13-step PLC programming, hardware verification, I/O mapping, and simulation pipeline.',
      items: PLC_TASKS,
    },
    {
      code: 'SCADA',
      name: 'SCADA Programming + Simulation',
      description: 'Standard 13-step SCADA system development, P&ID mimics, faceplates, alarms, and simulation.',
      items: SCADA_TASKS,
    },
    {
      code: 'HMI',
      name: 'HMI Programming + Simulation',
      description: 'Standard 13-step HMI operator panel development, diagnostic screens, tag linking, and simulation.',
      items: HMI_TASKS,
    },
  ];

  for (const t of templates) {
    const template = await prisma.checklistTemplate.upsert({
      where: { code: t.code },
      create: {
        code: t.code,
        name: t.name,
        description: t.description,
        category: 'AUTOMATION',
        isActive: true,
      },
      update: {
        name: t.name,
        description: t.description,
      },
    });

    for (const item of t.items) {
      const existing = await prisma.checklistTemplateItem.findFirst({
        where: { templateId: template.id, stepNumber: item.step },
      });

      if (existing) {
        await prisma.checklistTemplateItem.update({
          where: { id: existing.id },
          data: {
            code: item.code,
            title: item.title,
            recommendedSeniority: item.seniority,
            defaultDurationDays: item.days,
            isSimulationSignoff: Boolean(item.isSim),
            dependsOnStep: item.depends,
            sortOrder: item.step,
          },
        });
      } else {
        await prisma.checklistTemplateItem.create({
          data: {
            templateId: template.id,
            stepNumber: item.step,
            code: item.code,
            title: item.title,
            recommendedSeniority: item.seniority,
            defaultDurationDays: item.days,
            isSimulationSignoff: Boolean(item.isSim),
            dependsOnStep: item.depends,
            sortOrder: item.step,
          },
        });
      }
    }
  }

  console.log('Checklist Templates seeded successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
