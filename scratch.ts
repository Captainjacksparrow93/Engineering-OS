import { PrismaClient } from '@prisma/client';

const p = new PrismaClient().$extends({
  result: {
    user: {
      fullName: {
        needs: { fullName: true },
        compute(user) {
          if (!user.fullName) return user.fullName;
          const parts = user.fullName.trim().split(/\s+/);
          if (parts.length <= 2) return user.fullName.trim();
          return parts[0] + ' ' + parts[parts.length - 1];
        }
      }
    }
  }
});

async function main() {
  const users = await p.user.findMany({ select: { fullName: true } });
  console.log(users.map(u => u.fullName));
}
main().catch(console.error);
