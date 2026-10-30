import { guardMutation } from '@/lib/csrf';
import { exportCompany, isCompanyId } from '@/lib/data';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const formData = await request.formData();
    await guardMutation(formData);
  } catch {
    return new Response('This request was refused. Reload the company page and try again.', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  const { id } = await params;
  if (!isCompanyId(id)) return new Response('Invalid company id.', { status: 400 });
  try {
    const file = await exportCompany(id);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(file, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="waves-company-${id}-${date}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : String(caught);
    return new Response(null, {
      status: 303,
      headers: {
        Location: `/companies/${id}?error=${encodeURIComponent(error)}`,
        'Cache-Control': 'no-store',
      },
    });
  }
}
