export type RoomType = {
  id: string;
  name: string;
  image: string;
  /** max guests per room */
  capacity: number;
  beds: string;
  /** price per room per night (THB) */
  price: number;
  /** number of physical rooms of this type */
  inventory: number;
  description: string;
  amenities: string[];
};

// ข้อมูลเริ่มต้นสำหรับ seed เท่านั้น (ใช้ครั้งแรกตอน `npm run db:seed`) — แอปอ่านข้อมูลจริงจากฐานข้อมูล
// หลังติดตั้งแล้ว ให้แก้ราคา/ห้องในหลังบ้าน ไม่ใช่ที่ไฟล์นี้
// inventory รวมกัน = 15 ห้อง (ตามข้อมูลรีสอร์ท)
export const ROOM_TYPES: RoomType[] = [
  {
    id: "deluxe-sea-view",
    name: "Deluxe Sea View",
    image: "/images/room-1.jpg",
    capacity: 2,
    beds: "1 เตียงใหญ่",
    price: 3500,
    inventory: 7,
    description: "ห้องพักวิวทะเล บรรยากาศสงบ เหมาะสำหรับคู่รัก",
    amenities: ["เครื่องปรับอากาศ", "ระเบียงส่วนตัว", "ทีวีจอแบน", "ตู้เย็น", "เครื่องชงกาแฟ", "Wi-Fi ฟรี"],
  },
  {
    id: "villa-garden-view",
    name: "Villa Garden View",
    image: "/images/room-2.jpg",
    capacity: 4,
    beds: "2 เตียงใหญ่",
    price: 5900,
    inventory: 5,
    description: "วิลล่าวิวสวน กว้างขวาง เหมาะสำหรับกลุ่มเพื่อนหรือครอบครัวเล็ก",
    amenities: ["เครื่องปรับอากาศ", "ระเบียงส่วนตัว", "ทีวีจอแบน", "ตู้เย็น", "เครื่องชงกาแฟ", "Wi-Fi ฟรี"],
  },
  {
    id: "family-suite",
    name: "Family Suite",
    image: "/images/room-3.jpg",
    capacity: 6,
    beds: "2 เตียงใหญ่",
    price: 7900,
    inventory: 3,
    description: "ห้องสวีทขนาดใหญ่สำหรับครอบครัว พื้นที่นั่งเล่นแยก",
    amenities: ["เครื่องปรับอากาศ", "ระเบียงส่วนตัว", "ทีวีจอแบน", "ตู้เย็น", "เครื่องชงกาแฟ", "Wi-Fi ฟรี"],
  },
];

export function getRoomType(id: string | undefined) {
  return ROOM_TYPES.find((r) => r.id === id);
}

export const RESORT = {
  name: "ฟ้าทะเลรีสอร์ท",
  nameEn: "FahTalay Resort",
  phone: "087-744-5999",
  facebook: "https://www.facebook.com/fahtalayresort/",
  address: "78/12 หมู่ 1 ถนนเลียบหาดแม่รำพึง ต.บ้านเพ อ.เมืองระยอง จ.ระยอง 21160",
  checkInTime: "14:00",
  checkOutTime: "12:00",
  deposit: 500,
  maxNights: 30,
  /** ระยะเวลาที่ระบบกันห้องไว้ให้ระหว่างรอชำระเงิน (ชั่วโมง) */
  holdHours: 24,
  // ข้อมูลบัญชีตัวอย่าง — เปลี่ยนเป็นบัญชีจริงของรีสอร์ท
  bank: {
    name: "ธนาคารกสิกรไทย",
    accountName: "ฟ้าทะเลรีสอร์ท",
    accountNo: "xxx-x-xxxxx-x",
  },
};
