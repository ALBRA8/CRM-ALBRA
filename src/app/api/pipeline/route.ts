import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/api-auth';

// GET /api/pipeline - Get pipeline stages with opportunity counts and values
export async function GET(request: NextRequest) {
  const authResult = await getAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const stages = await db.pipelineStage.findMany({
    where: { userId: authResult.userId },
    include: {
      opportunities: {
        include: {
          client: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              temperature: true,
            },
          },
        },
      },
      _count: {
        select: { opportunities: true },
      },
    },
    orderBy: { order: 'asc' },
  });

  const pipelineData = stages.map((stage) => {
    const totalValue = stage.opportunities.reduce(
      (sum, opp) => sum + opp.estimatedValue,
      0
    );
    const avgProbability =
      stage.opportunities.length > 0
        ? Math.round(
            stage.opportunities.reduce((sum, opp) => sum + opp.probability, 0) /
              stage.opportunities.length
          )
        : 0;

    return {
      id: stage.id,
      name: stage.name,
      order: stage.order,
      color: stage.color,
      opportunityCount: stage._count.opportunities,
      totalValue,
      avgProbability,
      opportunities: stage.opportunities,
    };
  });

  const totalPipelineValue = pipelineData.reduce((sum, s) => sum + s.totalValue, 0);
  const totalOpportunities = pipelineData.reduce((sum, s) => sum + s.opportunityCount, 0);

  return NextResponse.json({
    stages: pipelineData,
    summary: {
      totalStages: pipelineData.length,
      totalOpportunities,
      totalPipelineValue,
    },
  });
}
