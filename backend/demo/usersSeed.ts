export type DemoUserSeed = {
  _id: string;
  name: string;
  email: string;
  phone: string;
};

export const demoUsers: DemoUserSeed[] = [
  {
    _id: "user-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+1-555-0101"
  },
  {
    _id: "user-2",
    name: "Grace Hopper",
    email: "grace@example.com",
    phone: "+1-555-0102"
  },
  {
    _id: "user-3",
    name: "Katherine Johnson",
    email: "katherine@example.com",
    phone: "+1-555-0103"
  }
];
